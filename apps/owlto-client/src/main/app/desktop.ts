import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createSdkMcpServer, query } from '@anthropic-ai/claude-agent-sdk/core'
import { is } from '@electron-toolkit/utils'
import { app, BrowserWindow, dialog, safeStorage, shell } from 'electron'
import type { AppEvent, ClaudeConnection } from '../../shared/app.js'
import type { UpdateSnapshot } from '../../shared/updates.js'
import type { UsageEntry } from '../../shared/usage-stats.js'
import { CardService } from '../cards/service.js'
import { CardStore } from '../cards/store.js'
import { ClaudeService } from '../claude/service.js'
import { safeText } from '../codex/protocol.js'
import { CodexService } from '../codex/service.js'
import { CursorService } from '../cursor/service.js'
import { configureDevAppInstanceProfile } from '../dev-app-instance.js'
import { GitHubAuth } from '../github/auth.js'
import { DreamingRunner } from '../memory/dreaming.js'
import { MemoryService } from '../memory/service.js'
import { MemoryStore } from '../memory/store.js'
import { MemorySweeper } from '../memory/sweep.js'
import { DreamingTriggers } from '../memory/triggers.js'
import {
  getDataRoot,
  memoryDreamingHome,
  projectsHome,
  routerThreadHome,
  workerWorktreesRoot,
  workspaceHome
} from '../owlto-paths.js'
import { RouterCredentials, type SecretCipher } from '../router/credentials.js'
import { CodexRouterServer } from '../router/engines/codex.js'
import {
  defaultEngineFactory,
  dreamingEngineFactory,
  type EngineDeps
} from '../router/engines/factory.js'
import { ProjectPullRequests } from '../router/project-pull-requests.js'
import { RouterService } from '../router/service.js'
import { RouterStore } from '../router/store.js'
import { WorkerGitHub } from '../router/worker-github.js'
import { GitWorkspaces } from '../router/worktrees.js'
import { AppUpdater } from '../updates/updater.js'
import { UsageLedger } from '../usage/ledger.js'
import { applyAppLogo } from './app-logo.js'
import { OwltoError } from './errors.js'
import { OwltoHost } from './host.js'
import { registerIpc } from './ipc.js'
import { applyAppMenu, type MenuDeps } from './menu.js'
import { OwltoStore } from './store.js'

const profile = configureDevAppInstanceProfile()
app.setName(profile ? `Owlto — ${profile.name}` : 'Owlto')
let window: BrowserWindow | null = null
let service: OwltoHost | null = null
let router: RouterService | null = null
let triggers: DreamingTriggers | null = null
let updater: AppUpdater | null = null
/** The Router's own Codex app-server; started only when the Codex engine runs. */
const codexRouter = new CodexRouterServer()
let quitApproved = false
let quitPrompt = false

function migrationsFolder(): string {
  const candidates = [
    join(process.resourcesPath, 'migrations'),
    join(app.getAppPath(), 'migrations'),
    join(__dirname, '../../migrations')
  ]
  const path = candidates.find((p) => existsSync(join(p, 'meta/_journal.json')))
  if (!path) throw new Error('The Codex database migrations are missing from this installation.')
  return path
}
function emit(event: AppEvent): void {
  router?.observe(event)
  triggers?.observe(event)
  if (window && !window.isDestroyed()) window.webContents.send('owlto:event', event)
}
function memoryChanged(): void {
  if (window && !window.isDestroyed()) window.webContents.send('owlto:memory-changed')
}
function cardsChanged(): void {
  if (window && !window.isDestroyed()) window.webContents.send('owlto:cards-changed')
}
function updatesChanged(snapshot: UpdateSnapshot): void {
  if (window && !window.isDestroyed()) window.webContents.send('owlto:updates-changed', snapshot)
}
/** Resolves true when the user chooses to stop running tasks and quit. */
async function askToStopTasks(): Promise<boolean> {
  const chinese = service?.snapshot().settings.language === 'zh-CN'
  const result = await dialog.showMessageBox({
    type: 'question',
    message: chinese ? '仍有任务正在运行' : 'Tasks are still running',
    detail: chinese ? '退出会中断当前任务。' : 'Quitting will interrupt the current tasks.',
    buttons: chinese ? ['继续工作', '停止并退出'] : ['Keep working', 'Stop and quit'],
    defaultId: 0,
    cancelId: 0
  })
  return result.response === 1
}
/**
 * Secrets use the OS keychain through async safeStorage, which also decrypts data
 * written by the old sync `encryptString`; a plain-text fallback is refused.
 */
const safeStorageCipher: SecretCipher = {
  unavailable: async () =>
    !(await safeStorage.isAsyncEncryptionAvailable())
      ? 'Secure storage is not available on this system.'
      : process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'
        ? 'Secure storage is using a plain-text fallback on this system.'
        : null,
  encrypt: async (plain) => (await safeStorage.encryptStringAsync(plain)).toString('base64'),
  decrypt: async (encoded) => {
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(
      Buffer.from(encoded, 'base64')
    )
    return { plain: result, stale: shouldReEncrypt }
  }
}
const closedClaude: ClaudeConnection = {
  status: 'disconnected',
  executablePath: null,
  version: null,
  account: { kind: 'unknown' },
  models: [],
  error: null
}
function createWindow(): void {
  window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 820,
    minHeight: 620,
    show: false,
    backgroundColor: '#181818',
    title: app.getName(),
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 18, y: 15 } }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  if (service) applyAppLogo(service.snapshot().settings.appLogo, window)
  window.once('ready-to-show', () => window?.show())
  // Keep the native profile name when the renderer loads its generic HTML title.
  window.on('page-title-updated', (event) => event.preventDefault())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event) => {
    // Vite reloads the page after an edit it cannot hot update.
    if (is.dev && event.url === window?.webContents.getURL()) return
    event.preventDefault()
  })
  window.on('closed', () => {
    window = null
  })
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else void window.loadFile(join(__dirname, '../renderer/index.html'))
}
void app
  .whenReady()
  .then(() => {
    const root = getDataRoot()
    mkdirSync(root, { recursive: true })
    const store = new OwltoStore(join(root, 'owlto.db'), migrationsFolder())
    service = new OwltoHost(
      new CodexService(store, emit),
      new ClaudeService(store, emit, { query, createSdkMcpServer }),
      new CursorService(store, emit),
      routerThreadHome(root),
      projectsHome(root),
      workspaceHome(root)
    )
    const usage = new UsageLedger(store)
    service.attachUsage(usage)
    const recordUsage = (entry: UsageEntry) => usage.record(entry)
    const routerStore = new RouterStore(store)
    const credentials = new RouterCredentials(routerStore, safeStorageCipher)
    const engineDeps: EngineDeps = {
      credentials,
      claude: {
        sdk: { query, createSdkMcpServer },
        connection: () => service?.claudeConnection() ?? closedClaude
      },
      codex: {
        server: codexRouter,
        connection: () =>
          service?.codexConnection() ?? { ...closedClaude, account: { kind: 'signed-out' } }
      }
    }
    const settings = () => store.settings()
    const projects = () => store.projects()
    const memory = new MemoryService({
      records: new MemoryStore(store),
      projects,
      settings,
      threadTitle: (id) => router?.title(id) ?? null,
      changed: memoryChanged
    })
    router = new RouterService(
      routerStore,
      credentials,
      store,
      service.workerHost(),
      emit,
      defaultEngineFactory(engineDeps),
      new GitWorkspaces(workerWorktreesRoot(root)),
      memory,
      recordUsage
    )
    service.attachRouter(router)
    const dreaming = new DreamingRunner({
      memory,
      threads: () => router?.snapshot().routers ?? [],
      items: (id) => routerStore.items(id),
      reports: (id, after) => routerStore.eventsAfter(id, after, 'worker_report'),
      worker: (id) => router?.worker(id),
      sessionItems: (id) => service?.sessionItems(id) ?? [],
      projects,
      settings,
      engine: dreamingEngineFactory({
        ...engineDeps,
        cwd: () => {
          const home = memoryDreamingHome(root)
          mkdirSync(home, { recursive: true })
          return home
        }
      }),
      changed: memoryChanged,
      recordUsage
    })
    triggers = new DreamingTriggers({
      threads: () => router?.snapshot().routers ?? [],
      workers: () => router?.snapshot().workers ?? [],
      schedule: (id) => dreaming.schedule(id)
    })
    const sweeper = new MemorySweeper({ sweep: () => memory.sweep() })
    service.attachMemory({ service: memory, dreaming, triggers, sweeper })
    service.attachCards(
      new CardService({
        store: new CardStore(store),
        projects,
        content: (source) => {
          if (!router) throw new OwltoError('router_unavailable', 'Threads are not available.')
          return router.contentOf(source)
        },
        changed: cardsChanged
      })
    )
    const github: GitHubAuth = new GitHubAuth(routerStore, safeStorageCipher, (account) => {
      emit({ type: 'github-account', account })
      if (account.status !== 'pending') workerGitHub.refresh()
    })
    const workerGitHub: WorkerGitHub = new WorkerGitHub(router, github, (workerId, status) =>
      emit({ type: 'worker-github', workerId, status })
    )
    const pullRequests = new ProjectPullRequests(
      {
        projects,
        workers: () => router?.snapshot().workers ?? [],
        projectRemoteUrl: async (project) => (await router?.projectRemoteUrl(project)) ?? null,
        remoteBranch: async (workerId) => (await router?.remoteBranch(workerId)) ?? null,
        linkPullRequest: (workerId, link) => router?.linkPullRequest(workerId, link)
      },
      github
    )
    service.attachGitHub({ auth: github, workers: workerGitHub, pullRequests })
    void github.load()
    updater = new AppUpdater({
      savedChannel: () => store.settings().updateChannel,
      changed: updatesChanged,
      approveQuit: async () => {
        if (service?.hasActiveTasks() && !(await askToStopTasks())) return false
        quitApproved = true
        return true
      }
    })
    const menu: MenuDeps = {
      window: () => {
        if (!window) createWindow()
        return window
      },
      checkForUpdates: () => void updater?.check()
    }
    registerIpc(
      service,
      () => window,
      updater,
      (saved, previous) => {
        if (
          saved.language !== previous.language ||
          saved.pullRequestsVisible !== previous.pullRequestsVisible
        )
          applyAppMenu(saved, menu)
      }
    )
    applyAppMenu(store.settings(), menu)
    createWindow()
    updater.start()
    void service.connect()
    void service.connectClaude()
    void service.connectCursor()
    app.on('activate', () => {
      if (!window) createWindow()
    })
  })
  .catch((error) => {
    dialog.showErrorBox(
      'Owlto could not start',
      safeText(error instanceof Error ? error.message : 'Startup failed.')
    )
    app.quit()
  })
app.on('before-quit', (event) => {
  if (quitApproved || !service?.hasActiveTasks()) return
  event.preventDefault()
  if (quitPrompt) return
  quitPrompt = true
  void askToStopTasks().then((approved) => {
    quitPrompt = false
    if (approved) {
      quitApproved = true
      app.quit()
    }
  })
})
app.on('will-quit', () => {
  updater?.dispose()
  updater = null
  service?.close()
  codexRouter.close()
  service = null
  router = null
  triggers = null
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
