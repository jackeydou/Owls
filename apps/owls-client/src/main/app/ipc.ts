import { writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { app, type BrowserWindow, dialog, type IpcMainInvokeEvent, ipcMain, shell } from 'electron'
import { z } from 'zod'
import { type Reply, respondSchema, settingsUpdateSchema } from '../../shared/app.js'
import {
  boardSaveSchema,
  cardCaptureSchema,
  cardIdSchema,
  cardSaveSchema
} from '../../shared/cards.js'
import { gitHubTokenSchema } from '../../shared/github.js'
import {
  memoryCategoryActionSchema,
  memoryExportSchema,
  memoryListSchema,
  memoryRemoveSchema,
  memorySaveSchema
} from '../../shared/memory.js'
import {
  cloneProjectSchema,
  createProjectSchema,
  saveProjectSchema
} from '../../shared/projects.js'
import {
  createThreadSchema,
  forwardSchema,
  owlsProviderSchema,
  resolveBatchSchema,
  sendRouterSchema,
  setRouterKeySchema,
  threadItemsSchema,
  workerActionSchema
} from '../../shared/router.js'
import type { AppUpdater } from '../updates/updater.js'
import { applyAppLogo } from './app-logo.js'
import { toFailure } from './errors.js'
import type { OwlsHost } from './host.js'

/**
 * Since Electron 43 an open dialog without `defaultPath` starts in Downloads and no longer
 * remembers the last folder, so pickers start where the user last was, or in their home folder.
 */
const executableFolder = (path: string | null) => (path ? dirname(path) : app.getPath('home'))

export function registerIpc(
  host: OwlsHost,
  getWindow: () => BrowserWindow | null,
  updates: Pick<AppUpdater, 'snapshot' | 'check' | 'install' | 'channelChanged'>
): void {
  let lastProjectParent = app.getPath('home')
  function handle<T>(channel: string, action: (input: unknown) => T | Promise<T>): void {
    ipcMain.handle(
      `owls:${channel}`,
      async (event: IpcMainInvokeEvent, input: unknown): Promise<Reply<T>> => {
        const window = getWindow()
        if (
          !window ||
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame
        ) {
          return { ok: false, error: { code: 'invalid_request', message: '' } }
        }
        try {
          return { ok: true, value: await action(input) }
        } catch (error) {
          return {
            ok: false,
            error:
              error instanceof z.ZodError
                ? { code: 'invalid_request', message: '' }
                : toFailure(error)
          }
        }
      }
    )
  }
  handle('snapshot', () => host.snapshot())
  handle('connect', () => host.connect())
  handle('connect-claude', () => host.connectClaude())
  handle('settings', (input) => {
    const previous = host.snapshot().settings
    const saved = host.saveSettings({ ...previous, ...settingsUpdateSchema.parse(input) })
    if (saved.appLogo !== previous.appLogo) applyAppLogo(saved.appLogo, getWindow())
    if (saved.updateChannel !== previous.updateChannel) updates.channelChanged()
    return saved
  })
  handle('respond', (input) => host.respond(respondSchema.parse(input)))
  handle('router-create', (input) => host.createThread(createThreadSchema.parse(input)))
  handle('router-items', (input) => host.threadItems(threadItemsSchema.parse(input)))
  handle('router-send', (input) => host.sendRouter(sendRouterSchema.parse(input)))
  handle('router-forward', (input) => host.forward(forwardSchema.parse(input)))
  handle('router-interrupt', (input) => host.interruptRouter(z.string().uuid().parse(input)))
  handle('router-resolve-batch', (input) => host.resolveBatch(resolveBatchSchema.parse(input)))
  handle('router-discard-worktree', async (input) => {
    const request = workerActionSchema.parse(input)
    const chinese = host.snapshot().settings.language === 'zh-CN'
    const result = await dialog.showMessageBox({
      type: 'warning',
      message: chinese ? '丢弃这个 worktree？' : 'Discard this worktree?',
      detail: chinese
        ? '这会删除 worktree 中未提交的修改，无法恢复。已提交到分支的内容会保留。'
        : 'This deletes its uncommitted changes and cannot be undone. Commits on its branch are kept.',
      buttons: chinese ? ['取消', '丢弃'] : ['Cancel', 'Discard'],
      defaultId: 0,
      cancelId: 0
    })
    if (result.response === 1) await host.discardWorktree(request)
  })
  handle('router-stop-worker', (input) => host.stopWorker(workerActionSchema.parse(input)))
  handle('router-remove-worker', async (input) => {
    const request = workerActionSchema.parse(input)
    const chinese = host.snapshot().settings.language === 'zh-CN'
    const result = await dialog.showMessageBox({
      type: 'question',
      message: chinese ? '移除这个 Worker？' : 'Remove this worker?',
      detail: chinese
        ? '已提交到分支的内容会保留，有未提交修改的 worktree 也会保留。'
        : 'Commits on its branch are kept, and so is a worktree with uncommitted changes.',
      buttons: chinese ? ['取消', '移除'] : ['Cancel', 'Remove'],
      defaultId: 0,
      cancelId: 0
    })
    if (result.response === 1) host.removeWorker(request)
  })
  handle('router-providers', () => host.routerProviders())
  handle('router-set-key', (input) => host.setRouterKey(setRouterKeySchema.parse(input)))
  handle('router-remove-key', (input) => host.removeRouterKey(owlsProviderSchema.parse(input)))
  handle('github-sign-in', () => host.gitHubSignIn())
  handle('github-connect-cli', () => host.gitHubConnectCli())
  handle('github-connect-token', (input) => host.gitHubConnectToken(gitHubTokenSchema.parse(input)))
  handle('github-cancel-sign-in', () => host.gitHubCancelSignIn())
  handle('github-sign-out', () => host.gitHubSignOut())
  handle('github-watch-worker', (input) => host.watchWorkerGitHub(workerActionSchema.parse(input)))
  handle('github-unwatch-worker', (input) =>
    host.unwatchWorkerGitHub(workerActionSchema.parse(input))
  )
  handle('memory-list', (input) => host.memoryList(memoryListSchema.parse(input)))
  handle('memory-overview', () => host.memoryOverview())
  handle('memory-save', (input) => host.memorySave(memorySaveSchema.parse(input)))
  handle('memory-remove', (input) => host.memoryRemove(memoryRemoveSchema.parse(input)))
  handle('memory-category', (input) => host.memoryCategory(memoryCategoryActionSchema.parse(input)))
  handle('memory-run', () => host.memoryRunNow())
  handle('memory-runs', () => host.memoryRuns())
  handle('cards-library', () => host.cardLibrary())
  handle('cards-save', (input) => host.cardSave(cardSaveSchema.parse(input)))
  handle('cards-capture', (input) => host.cardCapture(cardCaptureSchema.parse(input)))
  handle('cards-remove', (input) => host.cardRemove(cardIdSchema.parse(input)))
  handle('cards-save-board', (input) => host.boardSave(boardSaveSchema.parse(input)))
  handle('cards-remove-board', (input) => host.boardRemove(cardIdSchema.parse(input)))
  handle('updates-snapshot', () => updates.snapshot())
  handle('updates-check', () => updates.check())
  handle('updates-install', () => updates.install())
  handle('memory-export', async (input) => {
    const format = memoryExportSchema.parse(input)
    const text = host.memoryExport(format)
    const window = getWindow()
    const options = {
      defaultPath: format === 'json' ? 'owls-memory.json' : 'owls-memory.md',
      filters: [
        format === 'json'
          ? { name: 'JSON', extensions: ['json'] }
          : { name: 'Markdown', extensions: ['md'] }
      ]
    }
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return false
    await writeFile(result.filePath, text, 'utf8')
    return true
  })
  handle('cancel-sign-in', () => host.cancelSignIn())
  handle('sign-in', async () => {
    await shell.openExternal(await host.signIn())
  })
  handle('pick-project', async () => {
    const result = await dialog.showOpenDialog({
      defaultPath: lastProjectParent,
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    lastProjectParent = dirname(result.filePaths[0])
    return host.addProject(result.filePaths[0])
  })
  handle('projects-folder', () => host.projectsFolder())
  handle('choose-projects-folder', async () => {
    const result = await dialog.showOpenDialog({
      defaultPath: host.projectsFolder(),
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0]
  })
  handle('clone-project', (input) => host.cloneProject(cloneProjectSchema.parse(input)))
  handle('create-project', (input) => host.createProject(createProjectSchema.parse(input)))
  handle('save-project', (input) => host.saveProject(saveProjectSchema.parse(input)))
  handle('project-git-refs', (input) =>
    host.projectGitRefs(saveProjectSchema.shape.id.parse(input))
  )
  handle('select-executable', async () => {
    const result = await dialog.showOpenDialog({
      defaultPath: executableFolder(host.snapshot().settings.executablePath),
      properties: ['openFile', 'showHiddenFiles']
    })
    if (result.canceled || !result.filePaths[0]) return null
    host.saveSettings({ ...host.snapshot().settings, executablePath: result.filePaths[0] })
    return host.connect()
  })
  handle('select-claude-executable', async () => {
    const result = await dialog.showOpenDialog({
      defaultPath: executableFolder(host.snapshot().settings.claudeExecutablePath),
      properties: ['openFile', 'showHiddenFiles']
    })
    if (result.canceled || !result.filePaths[0]) return null
    host.saveSettings({ ...host.snapshot().settings, claudeExecutablePath: result.filePaths[0] })
    return host.connectClaude()
  })
}
