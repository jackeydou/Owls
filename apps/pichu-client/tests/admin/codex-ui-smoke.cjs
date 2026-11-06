const assert = require('node:assert/strict')
const { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { app, BrowserWindow, dialog } = require('electron')
const packageIndex = process.argv.indexOf('--packaged-app')
const resources =
  packageIndex >= 0 ? join(resolve(process.argv[packageIndex + 1]), 'Contents/Resources') : null
const artifactRoot = resources ? join(resources, 'app.asar') : resolve(__dirname, '../..')
const {
  ClaudeService,
  CodexService,
  CodexStore,
  OwlsHost,
  RouterCredentials,
  RouterService,
  RouterStore,
  CodexRouterServer,
  defaultEngineFactory
} = require(join(artifactRoot, 'out/main/codex/runtime.js'))
// Router keys in this test never touch the OS keychain.
const testCipher = {
  unavailable: () => null,
  encrypt: (plain) => Buffer.from(plain).toString('base64'),
  decrypt: (encoded) => Buffer.from(encoded, 'base64').toString()
}
const { registerCodexIpc } = require(join(artifactRoot, 'out/main/codex/ipc.js'))

// A scripted Agent SDK stand-in for the Claude Code task flow.
const claudeSdk = {
  query({ prompt, options }) {
    const init = { type: 'system', subtype: 'init', session_id: 'claude-ui-session' }
    const done = { type: 'result', subtype: 'success', is_error: false, result: '', usage: {} }
    const generator = (async function* () {
      const first = await prompt[Symbol.asyncIterator]().next()
      if (first.done) return
      yield init
      if (first.value.message.content === 'claude approval') {
        const input = { command: 'ls -la', description: 'List files' }
        yield {
          type: 'assistant',
          parent_tool_use_id: null,
          message: {
            id: 'claude-m2',
            content: [{ type: 'tool_use', id: 'claude-tool', name: 'Bash', input }]
          }
        }
        const decision = await options.canUseTool('Bash', input, {
          signal: new AbortController().signal
        })
        yield {
          type: 'user',
          parent_tool_use_id: null,
          message: {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'claude-tool',
                content: 'total 0',
                is_error: decision.behavior !== 'allow'
              }
            ]
          }
        }
      } else {
        yield {
          type: 'assistant',
          parent_tool_use_id: null,
          message: { id: 'claude-m1', content: [{ type: 'text', text: 'claude says hi' }] }
        }
      }
      yield done
    })()
    return Object.assign(generator, {
      initializationResult: async () => ({
        models: [{ value: 'sonnet', displayName: 'Sonnet', description: '' }],
        account: { email: 'claude@example.com', subscriptionType: 'pro' }
      }),
      interrupt: async () => {},
      close: () => {}
    })
  }
}
// Plays the Router model: each `派发：<title>` line, with an optional ` < <parent title>`
// from the same batch, dispatches a worker that the reply then refers to.
const SCRIPTED_MODEL = 'smoke-scripted'
const scriptedRuns = []
function scriptedEngine({ tools }) {
  return {
    async run(input, sink) {
      scriptedRuns.push(input.text)
      const dispatch = tools.find((tool) => tool.name === 'dispatch_task')
      const ids = new Map()
      for (const [, title, parent] of input.text.matchAll(/派发：(.+?)(?: < (.+))?$/gm)) {
        const { workerId } = JSON.parse(
          await dispatch.execute({
            goal: `Smoke goal for ${title}`,
            title,
            ...(parent ? { parent: ids.get(parent) } : {})
          })
        )
        ids.set(title, workerId)
      }
      const links = [...ids].map(([title, id]) => `[${title}](#worker-${id})`)
      sink.item({
        id: `reply-${scriptedRuns.length}`,
        kind: 'assistant',
        status: 'completed',
        text: links.length ? `已派出 ${links.join('、')}` : '收到',
        detail: '',
        turnId: input.batchId
      })
      return { status: 'completed', error: null, native: { engine: 'owls' } }
    },
    steer: async () => 'not_running',
    abort() {}
  }
}
const captureIndex = process.argv.indexOf('--capture-dir')
const captureDir = captureIndex >= 0 ? process.argv[captureIndex + 1] : null
app.disableHardwareAcceleration()
// The window is hidden, so a confirmation is recorded and accepted here.
const confirmations = []
dialog.showMessageBox = async (...args) => {
  confirmations.push(args)
  return { response: 1 }
}

app
  .whenReady()
  .then(async () => {
    const temp = mkdtempSync(join(tmpdir(), 'owls-codex-ui-'))
    let window
    let host
    let router
    const evaluate = (source) => window.webContents.executeJavaScript(source)
    const waitFor = async (condition) => {
      const check = typeof condition === 'function' ? condition : () => evaluate(condition)
      const deadline = Date.now() + 12_000
      while (!(await check())) {
        assert.ok(Date.now() < deadline, `Timed out waiting for UI: ${condition}`)
        await new Promise((resolve) => setTimeout(resolve, 30))
      }
    }
    const type = (text) =>
      evaluate(`(() => {
      const input = document.querySelector('.router-editor textarea, .router-composer textarea')
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(text)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
    const send = async (text) => {
      await type(text)
      await waitFor(
        "document.querySelector('.router-editor-send, .codex-send')?.disabled === false"
      )
      await evaluate("document.querySelector('.router-editor-send, .codex-send').click()")
    }
    const pressInEditor = (key, modifiers = {}) =>
      evaluate(
        `document.querySelector('.router-editor textarea').dispatchEvent(new KeyboardEvent('keydown', ${JSON.stringify({ key, bubbles: true, cancelable: true, ...modifiers })}))`
      )
    const press = (key, modifiers = {}) =>
      evaluate(
        `window.dispatchEvent(new KeyboardEvent('keydown', ${JSON.stringify({ key, bubbles: true, ...modifiers })}))`
      )
    // Finite animations only: a running branch's flow never ends.
    const settled = () =>
      waitFor(
        "document.getAnimations().every((a) => a.effect.getTiming().iterations === Infinity || a.playState !== 'running')"
      )
    // Presses a key, then lists the view transition's animated layers until they are gone.
    const zoomLayers = (key, modifiers = {}) =>
      evaluate(`(async () => {
        const seen = new Set()
        window.dispatchEvent(new KeyboardEvent('keydown', ${JSON.stringify({ key, bubbles: true, ...modifiers })}))
        for (const start = performance.now(); performance.now() - start < 200; ) {
          await new Promise(requestAnimationFrame)
          for (const a of document.getAnimations()) if (/old|new/.test(a.effect.pseudoElement)) seen.add(a.effect.pseudoElement)
        }
        return [...seen].sort()
      })()`)
    const watchMap = () =>
      evaluate(`(() => {
        window.mapMotion = { signals: [], grown: [], branches: [], reshaped: false, answerColor: null }
        const watchBranches = () => {
          window.mapMotion.reshaped ||= document.getAnimations().some((a) => a.transitionProperty === 'd')
          if (document.querySelector('.map-view')) requestAnimationFrame(watchBranches)
        }
        watchBranches()
        const added = (selector, record) =>
          new MutationObserver((changes) => {
            for (const change of changes) for (const node of change.addedNodes) record(node)
          }).observe(document.querySelector(selector), { childList: true })
        added('.map-signals', (node) => {
          window.mapMotion.signals.push(node.className)
          if (node.className === 'map-signal answer')
            window.mapMotion.answerColor = getComputedStyle(node).backgroundColor
        })
        added('.map-nodes', (node) => window.mapMotion.grown.push(node.getAnimations().length))
        added('.map-edges', (node) => window.mapMotion.branches.push(node.querySelector('path').getAnimations().length))
      })()`)
    const signalSeen = (name) => `window.mapMotion.signals.includes(${JSON.stringify(name)})`
    const capture = async (name) => {
      if (!captureDir) return
      mkdirSync(captureDir, { recursive: true })
      // Lets the offscreen compositor catch up, or the image can show the previous state.
      await new Promise((resolve) => setTimeout(resolve, 300))
      await evaluate(
        'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
      )
      const nextPaint = () =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            window.webContents.removeListener('paint', onPaint)
            reject(new Error('UI preview did not paint.'))
          }, 5000)
          const onPaint = (_event, _dirty, image) => {
            clearTimeout(timer)
            resolve(image)
          }
          window.webContents.once('paint', onPaint)
          window.webContents.invalidate()
        })
      await nextPaint()
      await nextPaint()
      const image = await nextPaint()
      writeFileSync(join(captureDir, `${name}.png`), image.toPNG())
      writeFileSync(
        join(captureDir, `${name}.json`),
        JSON.stringify(
          await evaluate(
            '({ theme: document.documentElement.dataset.theme, background: getComputedStyle(document.querySelector(".codex-app")).backgroundColor, settingsText: document.querySelector(".codex-settings-actions")?.textContent })'
          )
        )
      )
    }
    try {
      const fixture = resolve(__dirname, '../fixtures/codex/mock-codex.cjs')
      chmodSync(fixture, 0o755)
      const store = new CodexStore(
        join(temp, 'test.db'),
        join(resources ?? artifactRoot, 'drizzle-codex')
      )
      const claudeFixture = resolve(__dirname, '../fixtures/claude/mock-claude.cjs')
      chmodSync(claudeFixture, 0o755)
      store.saveSettings({
        ...store.settings(),
        executablePath: fixture,
        claudeExecutablePath: claudeFixture
      })
      const emit = (event) => {
        router?.observe(event)
        if (window && !window.isDestroyed()) window.webContents.send('codex:event', event)
      }
      host = new OwlsHost(new CodexService(store, emit), new ClaudeService(store, emit, claudeSdk))
      const routerStore = new RouterStore(store)
      const credentials = new RouterCredentials(routerStore, testCipher)
      const realEngines = defaultEngineFactory({
        credentials,
        claude: { sdk: claudeSdk, connection: () => host.claudeConnection() },
        codex: { server: new CodexRouterServer(), connection: () => host.codexConnection() }
      })
      const startRouter = () =>
        new RouterService(routerStore, credentials, store, host.workerHost(), emit, (request) =>
          request.settings.owls?.model === SCRIPTED_MODEL
            ? scriptedEngine(request)
            : realEngines(request)
        )
      const startScriptedRouter = async () => {
        const { settings } = host.snapshot()
        host.saveSettings({
          ...settings,
          router: {
            ...settings.router,
            engine: 'owls',
            owls: {
              provider: 'anthropic',
              model: SCRIPTED_MODEL,
              thinking: 'off',
              baseUrl: null
            }
          }
        })
        await window.reload()
        await waitFor("Boolean(document.querySelector('.router-editor textarea:not(:read-only)'))")
      }
      router = startRouter()
      host.attachRouter(router)
      await host.connect()
      window = new BrowserWindow({
        show: false,
        width: 1280,
        height: 860,
        webPreferences: {
          preload: join(artifactRoot, 'out/preload/index.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          backgroundThrottling: false,
          offscreen: true
        }
      })
      registerCodexIpc(host, () => window)
      await window.loadFile(join(artifactRoot, 'out/renderer/index.html'))
      await waitFor("Boolean(document.querySelector('.router-chat'))")
      assert.equal(await evaluate('typeof window.require'), 'undefined')
      assert.equal(await evaluate('typeof window.api'), 'undefined')
      assert.equal(await evaluate('typeof window.electron'), 'undefined')
      assert.equal(await evaluate("'invoke' in window.codex"), false)
      const invalidSettings = await evaluate(
        'window.codex.snapshot().then(snapshot => window.codex.saveSettings({ ...snapshot.value.settings, executablePath: "/bin/sh" }))'
      )
      assert.equal(invalidSettings.ok, false)
      assert.equal(invalidSettings.error.code, 'invalid_request')
      assert.equal(host.snapshot().settings.executablePath, fixture)

      // First run opens on the guide, without the thread or its editor.
      await waitFor("Boolean(document.querySelector('.router-guide-option'))")
      assert.equal(await evaluate("Boolean(document.querySelector('.router-editor'))"), false)
      assert.equal(await evaluate("Boolean(document.querySelector('.router-status'))"), false)
      await capture('router-guide')
      assert.equal(
        await evaluate("Boolean(document.querySelector('#router-provider'))"),
        false,
        'the built-in engine stays folded until it is picked'
      )
      await evaluate("Array.from(document.querySelectorAll('.router-guide-option')).at(-1).click()")
      await waitFor("Boolean(document.querySelector('.router-guide-continue'))")
      assert.equal(
        await evaluate("document.querySelector('.router-guide-continue').disabled"),
        true,
        'the built-in engine needs a model and a key'
      )
      // Choosing the agent that is already connected finishes setup and opens the editor.
      await evaluate(
        "Array.from(document.querySelectorAll('.router-guide-option')).find(el => el.querySelector('strong').textContent === 'Codex').click()"
      )
      await waitFor("Boolean(document.querySelector('.router-editor textarea'))")
      assert.equal(host.snapshot().settings.router.engine, 'codex')
      assert.equal(await evaluate("Boolean(document.querySelector('.router-guide'))"), false)
      await capture('router-home')
      {
        const { settings } = host.snapshot()
        host.saveSettings({ ...settings, router: { ...settings.router, engine: 'owls' } })
        await window.reload()
      }
      // It comes back while setup is incomplete, and skipping leaves a note in the thread.
      await waitFor("Boolean(document.querySelector('.router-guide-skip'))")
      await evaluate("document.querySelector('.router-guide-skip').click()")
      await waitFor("Boolean(document.querySelector('.router-editor textarea'))")
      await waitFor(
        "document.querySelector('.router-setup-notice button')?.textContent.includes('Use Codex')"
      )

      await evaluate("document.querySelector('.router-sidebar-settings').click()")
      await waitFor("Boolean(document.querySelector('.codex-settings-content'))")
      assert.ok(
        await evaluate(
          "document.querySelector('.codex-account-info').textContent.includes('fixture@example.com')"
        )
      )
      assert.ok(await evaluate("document.body.textContent.includes('Worker defaults')"))
      await evaluate("document.querySelector('.codex-settings-actions button').click()")
      await waitFor("document.querySelector('.codex-settings-actions button')?.disabled === false")
      await evaluate(
        "document.querySelector('#codex-theme').value = 'dark'; document.querySelector('#codex-theme').dispatchEvent(new Event('change', { bubbles: true }))"
      )
      await waitFor("document.documentElement.dataset.theme === 'dark'")
      await evaluate(
        "document.querySelector('#codex-language').value = 'zh-CN'; document.querySelector('#codex-language').dispatchEvent(new Event('change', { bubbles: true }))"
      )
      await waitFor("document.body.textContent.includes('导入并使用本地 Codex 登录')")
      assert.equal(host.snapshot().settings.language, 'zh-CN')
      assert.equal(host.snapshot().settings.theme, 'dark')
      assert.equal(host.snapshot().settings.appLogo, 'solid')
      await evaluate(
        "[...document.querySelectorAll('input[name=codex-app-logo]')].length === 3 && document.querySelectorAll('input[name=codex-app-logo]')[0].click()"
      )
      await waitFor("document.querySelector('.router-sidebar-logo img')?.dataset.logo === 'line'")
      assert.equal(host.snapshot().settings.appLogo, 'line')
      await capture('settings')
      await press('Escape')
      await waitFor("Boolean(document.querySelector('.router-chat'))")

      // Router: an unconfigured Owls engine shows setup, and keys never come back out.
      await waitFor("document.body.textContent.includes('为协调者选择模型')")
      await type('帮我看看项目')
      await waitFor("Boolean(document.querySelector('.router-editor-send'))")
      await pressInEditor('Enter')
      assert.equal(host.snapshot().routers[0]?.items.length ?? 0, 0, 'Enter is a new line')
      // No project yet: sending asks for a folder, and canceling keeps the draft.
      const pickFolder = dialog.showOpenDialog
      let folderAsks = 0
      dialog.showOpenDialog = async () => {
        folderAsks += 1
        return folderAsks === 1
          ? { canceled: true, filePaths: [] }
          : { canceled: false, filePaths: [temp] }
      }
      await pressInEditor('Enter', { metaKey: true })
      await waitFor("Boolean(document.querySelector('.router-editor textarea:not(:read-only)'))")
      while (!folderAsks) await new Promise((resolve) => setTimeout(resolve, 30))
      assert.equal(
        await evaluate("document.querySelector('.router-editor textarea').value"),
        '帮我看看项目'
      )
      await pressInEditor('Enter', { metaKey: true })
      await waitFor(
        "Array.from(document.querySelectorAll('.router-chat .codex-user-message')).some(el => el.textContent.includes('帮我看看项目'))"
      )
      await waitFor("document.querySelector('.router-chat textarea')?.value === ''")
      dialog.showOpenDialog = pickFolder
      await waitFor(
        "document.querySelector('.router-project')?.getAttribute('aria-current') === 'true'"
      )
      // The sidebar hides completely, leaves its toggle on the title bar, and remembers.
      await evaluate("document.querySelector('.router-sidebar-toggle').click()")
      await waitFor(
        "!document.querySelector('.router-sidebar') && Boolean(document.querySelector('.router-sidebar-toggle'))"
      )
      assert.equal(host.snapshot().settings.sidebarCollapsed, true)
      assert.ok(
        await evaluate(
          "Boolean(document.querySelector('.router-stage').compareDocumentPosition(document.querySelector('.router-sidebar-toggle')) & Node.DOCUMENT_POSITION_FOLLOWING)"
        ),
        'the toggle follows the stage, or the title bar drag region swallows its clicks'
      )
      await capture('sidebar-hidden')
      await evaluate("document.querySelector('.router-sidebar-toggle').click()")
      await waitFor("Boolean(document.querySelector('.router-sidebar'))")
      assert.equal(host.snapshot().settings.sidebarCollapsed, false)
      await evaluate("document.querySelector('.router-editor textarea').focus()")
      const editorFocused =
        "document.activeElement === document.querySelector('.router-editor textarea')"
      assert.ok(await evaluate(editorFocused), 'sending keeps the caret in the editor')
      assert.equal(
        await evaluate(
          "getComputedStyle(document.querySelector('.router-editor textarea')).outlineStyle"
        ),
        'none',
        'the focused editor has no ring'
      )
      await evaluate(
        "document.activeElement.blur(); document.querySelector('.router-chat .codex-conversation').click()"
      )
      assert.ok(await evaluate(editorFocused), 'a click on the blank page returns to the editor')
      const routerState = host.snapshot().routers[0]
      assert.equal(routerState.error.code, 'router_model_unconfigured')
      assert.equal(routerState.items[0].text, '帮我看看项目')
      await capture('router-setup')
      const saved = await evaluate(
        "window.codex.setRouterKey({ providerId: 'anthropic', key: 'sk-owls-ui-secret' })"
      )
      assert.equal(saved.ok, true)
      const providers = await evaluate('window.codex.routerProviders()')
      assert.equal(providers.ok, true)
      assert.equal(providers.value.find((p) => p.id === 'anthropic').configured, true)
      assert.ok(!JSON.stringify(providers).includes('sk-owls-ui-secret'))
      assert.ok(!JSON.stringify(host.snapshot()).includes('sk-owls-ui-secret'))
      assert.ok(await evaluate("typeof window.codex.routerKey === 'undefined'"))
      const badKey = await evaluate("window.codex.setRouterKey({ providerId: 'nope', key: 'x' })")
      assert.equal(badKey.ok, false)
      assert.equal(badKey.error.code, 'invalid_request')

      // Router Inbox on SQLite: the unsent message waits, and a batch left sending by a
      // crash comes back as dispatch_unknown that the user can resend.
      const pending = routerStore.events(routerState.id, 'pending')
      assert.deepEqual(
        pending.map((e) => [e.kind, e.text]),
        [['user_message', '帮我看看项目']]
      )
      routerStore.openBatch(
        {
          id: 'b_crashed',
          routerId: routerState.id,
          createdAt: new Date().toISOString(),
          engine: 'owls',
          promptVersion: 1
        },
        pending.map((e) => e.seq)
      )
      assert.equal(routerStore.events(routerState.id, 'pending').length, 0)
      router.close()
      router = startRouter()
      host.attachRouter(router)
      assert.equal(routerStore.batch('b_crashed').status, 'dispatch_unknown')
      await window.reload()
      await waitFor("Boolean(document.querySelector('.router-unknown-batch'))")
      assert.ok(
        await evaluate(
          "document.querySelector('.router-unknown-batch').textContent.includes('1 个事件')"
        )
      )
      await capture('router-unknown-batch')
      await evaluate(
        "Array.from(document.querySelectorAll('.router-unknown-batch button')).find(el => el.textContent === '重新发送').click()"
      )
      await waitFor("!document.querySelector('.router-unknown-batch')")
      assert.equal(routerStore.batch('b_crashed').status, 'retried')
      // The engine is still unconfigured, so the resent message waits in the Inbox again.
      await waitFor("document.body.textContent.includes('为协调者选择模型')")
      assert.equal(routerStore.events(routerState.id, 'pending').length, 1)
      // recall reads events back by sequence and by worker through SQLite JSON queries.
      const [waiting] = routerStore.events(routerState.id, 'pending')
      assert.equal(routerStore.event(waiting.seq).event.text, '帮我看看项目')
      const workerEvent = routerStore.appendEvent(routerState.id, crypto.randomUUID(), {
        kind: 'worker_failed',
        at: new Date().toISOString(),
        workerId: 'w_smoke',
        goal: 'Smoke'
      })
      assert.deepEqual(
        routerStore.workerEvents(routerState.id, 'w_smoke', 10).map((e) => e.seq),
        [workerEvent.seq]
      )
      routerStore.setEventStatus([workerEvent.seq], 'dropped')

      // Choosing another engine swaps the Router details and drops the Owls fields.
      await evaluate("document.querySelector('.router-sidebar-settings').click()")
      await waitFor("Boolean(document.querySelector('#router-engine'))")
      await evaluate(
        "document.querySelector('#router-engine').value = 'claude-code'; document.querySelector('#router-engine').dispatchEvent(new Event('change', { bubbles: true }))"
      )
      await waitFor(
        "Boolean(document.querySelector('#router-claude-model')) && !document.querySelector('#router-provider')"
      )
      assert.equal(host.snapshot().settings.router.engine, 'claude-code')
      await capture('router-claude-settings')
      await press('Escape')
      // The note's button switches the Router to the connected agent in one click.
      await waitFor(
        "document.querySelector('.router-setup-notice button')?.textContent.includes('使用 Codex')"
      )
      await evaluate("document.querySelector('.router-setup-notice button').click()")
      await waitFor(() => host.snapshot().settings.router.engine === 'codex')
      // The message that waited for a working engine goes out without being sent again.
      await waitFor(() => routerStore.events(routerState.id, 'pending').length === 0)
      await waitFor(() => host.snapshot().routers[0].status !== 'running')
      await evaluate('document.querySelector(\'[aria-label="协调者详情"]\').click()')
      await waitFor("document.querySelector('.router-model')?.textContent.includes('Codex')")
      await press('Escape')
      await waitFor("!document.querySelector('.router-panel')")

      // From here a scripted engine plays the Router so the worker flows run for real.
      await startScriptedRouter()
      await send('派发：烟雾 Worker')
      await waitFor(
        "document.querySelector('.router-dispatch')?.textContent.includes('烟雾 Worker')"
      )
      await waitFor(() => host.snapshot().workers[0]?.status === 'idle')
      const [worker] = host.snapshot().workers
      assert.equal(worker.title, '烟雾 Worker')
      assert.equal(await evaluate("document.querySelectorAll('.router-dispatch').length"), 1)
      // The reference in the reply opens the worker; external links stay Streamdown's.
      await evaluate(
        "document.querySelector('.codex-assistant-message .router-worker-link').click()"
      )
      await waitFor("document.querySelector('.router-brief')?.textContent.includes('协调者下发')")
      await evaluate(
        "Array.from(document.querySelectorAll('.router-tabs button')).find(el => el.textContent === '汇报').click()"
      )
      await waitFor("document.querySelector('.router-report')?.textContent.includes('hello world')")
      await capture('worker-report')
      await press('Escape')
      await waitFor("!document.querySelector('.router-panel')")

      // `@` addresses a worker. The message reaches it with no Router model call, and an
      // approval shows in the tray without waking the Router either.
      const batches = () => scriptedRuns.length
      const before = batches()
      await type('看看 @烟')
      await waitFor("Boolean(document.querySelector('.router-mentions button'))")
      await evaluate(
        "document.querySelector('.router-mentions button').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))"
      )
      await waitFor("document.querySelector('.router-target')?.textContent.includes('烟雾 Worker')")
      assert.equal(await evaluate("document.querySelector('.router-chat textarea').value"), '看看 ')
      await send('approval')
      await waitFor("Boolean(document.querySelector('.router-tray .codex-request'))")
      assert.ok(await evaluate("Boolean(document.querySelector('.router-directed'))"))
      assert.equal(await evaluate("Boolean(document.querySelector('.router-target'))"), false)
      assert.ok(
        await evaluate("document.querySelector('.router-status').textContent.includes('1 个等你')")
      )
      assert.equal(batches(), before)
      assert.ok(
        await evaluate(
          "document.querySelector('.router-chat textarea').getBoundingClientRect().bottom <= innerHeight"
        ),
        'the editor stays on screen under the tray'
      )
      await capture('approval-tray')
      await evaluate(
        "Array.from(document.querySelectorAll('.router-tray button')).find(el => el.textContent === '拒绝').click()"
      )
      await waitFor("!document.querySelector('.router-tray')")
      await waitFor(() => host.snapshot().workers[0]?.status === 'idle')

      // The overview map: worker nodes, the composer following the selection, node approvals.
      // Opening it is one zoom over the stage, while the rail and any open details hold still.
      assert.deepEqual(await zoomLayers('j', { metaKey: true }), [
        '::view-transition-new(router-stage)',
        '::view-transition-old(router-stage)'
      ])
      await waitFor("Boolean(document.querySelector('.map-view'))")
      await settled()
      await watchMap()
      await waitFor("Boolean(document.querySelector('.map-node.done'))")
      await evaluate("document.querySelector('.map-node.done').click()")
      const nodeOf = `document.querySelector('[data-node="${worker.id}"]')`
      await waitFor(`Boolean(${nodeOf})`)
      await evaluate(`${nodeOf}.click()`)
      await waitFor(
        "document.querySelector('.map-bar .router-target')?.textContent.includes('烟雾 Worker')"
      )
      await send('tools')
      await waitFor(() => host.snapshot().workers[0]?.status === 'idle')
      // A report travels back along the branch and lands on the project.
      await waitFor(signalSeen('map-signal report'))
      await waitFor(signalSeen('map-ping report'))
      await evaluate(
        "Array.from(document.querySelectorAll('.router-tabs button')).find(el => el.textContent === '改动').click()"
      )
      await waitFor("document.querySelector('.router-diff')?.textContent.includes('hello world')")
      await capture('map-detail')
      await send('approval')
      await waitFor(`Boolean(${nodeOf}?.querySelector('pre'))`)
      assert.equal(await evaluate(`${nodeOf}.querySelector('pre').textContent`), 'echo fixture')
      // The input frees up while the request waits, so the worker can still be addressed.
      await waitFor("document.querySelector('.map-bar textarea').value === ''")
      await capture('map-approval')
      await evaluate(`${nodeOf}.querySelector('.map-actions button').click()`)
      await waitFor(`!${nodeOf}?.querySelector('pre')`)
      await waitFor(() => host.snapshot().workers[0]?.status === 'idle')
      await waitFor(signalSeen('map-signal answer'))
      assert.equal(
        await evaluate('window.mapMotion.answerColor'),
        await evaluate(
          "(() => { const probe = document.createElement('i'); probe.style.color = 'var(--owl-wait)'; document.body.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return color })()"
        )
      )
      await send('question')
      await waitFor(`${nodeOf}?.textContent.includes('需要回答')`)
      await evaluate(
        "Array.from(document.querySelectorAll('.router-tabs button')).find(el => el.textContent === '活动').click()"
      )
      await waitFor('Boolean(document.querySelector(\'.router-panel input[type="radio"]\'))')
      await evaluate('document.querySelector(\'.router-panel input[type="radio"]\').click()')
      await waitFor(
        'document.querySelector(\'.router-panel button[type="submit"]\').disabled === false'
      )
      await evaluate('document.querySelector(\'.router-panel button[type="submit"]\').click()')
      await waitFor("!document.querySelector('.router-panel .codex-request')")
      await waitFor(() => host.snapshot().workers[0]?.status === 'idle')
      // Dots flow along a branch only while its worker runs.
      await send('long')
      const flowOf = `document.querySelector('[data-edge="${worker.id}"] .map-flow')`
      await waitFor(`Boolean(${flowOf})`)
      assert.equal(await evaluate(`getComputedStyle(${flowOf}).animationName`), 'map-flow')
      await capture('map-flow')
      await evaluate('document.querySelector(\'[aria-label="停止 Worker"]\').click()')
      await waitFor(`!${flowOf}`)

      // Removing a worker asks first, closes its details, and takes it off the map.
      await evaluate('document.querySelector(\'[aria-label="移除 Worker"]\').click()')
      await waitFor("!document.querySelector('.router-panel')")
      await waitFor(`!${nodeOf}`)
      assert.equal(confirmations.length, 1)
      assert.equal(host.snapshot().workers[0].status, 'removed')
      await press('Escape')
      await waitFor("Boolean(document.querySelector('.router-chat'))")

      // A tree across projects: child workers branch off their parent, and a project with
      // no conversation still has a small node to enter it from.
      const secondProject = join(temp, 'second-project')
      mkdirSync(secondProject)
      host.addProject(secondProject)
      await window.reload()
      await waitFor("Boolean(document.querySelector('.router-editor textarea:not(:read-only)'))")
      await send('派发：拆分\n派发：实现 < 拆分\n派发：评审 < 拆分\n派发：收尾 < 实现')
      await waitFor(() => host.snapshot().workers.filter((w) => w.parentId).length === 3)
      await waitFor(() =>
        host.snapshot().workers.every((w) => ['idle', 'removed'].includes(w.status))
      )
      await press('j', { metaKey: true })
      await waitFor("Boolean(document.querySelector('.map-view'))")
      await evaluate(
        "Array.from(document.querySelectorAll('.map-filter button')).find(el => el.textContent === '全部').click()"
      )
      await waitFor("document.querySelectorAll('.map-node.worker').length === 4")
      assert.ok(await evaluate("Boolean(document.querySelector('.map-node.project.quiet'))"))
      assert.equal(await evaluate("document.querySelectorAll('.map-edge').length"), 7)
      await settled()
      assert.equal(
        await evaluate(`(() => {
          const boxes = [...document.querySelectorAll('.map-node')].map((el) => el.getBoundingClientRect())
          return boxes.filter((a, i) => boxes.some((b, j) => j > i &&
            a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom)).length
        })()`),
        0
      )
      await capture('map-tree')
      // Zooming stays on the canvas, F hands the camera back, and arrows walk the tree.
      const zoomLevel = "document.querySelector('.map-zoom span').textContent"
      const fitted = await evaluate(zoomLevel)
      await evaluate(
        "document.querySelector('.map-stage').dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -20, clientX: 500, clientY: 400, bubbles: true, cancelable: true }))"
      )
      assert.notEqual(await evaluate(zoomLevel), fitted)
      await press('f')
      assert.equal(await evaluate(zoomLevel), fitted)
      await press('ArrowRight')
      await waitFor('document.activeElement?.dataset.node?.startsWith("project:")')
      await press('Enter')
      await waitFor("Boolean(document.querySelector('.router-chat'))")
      // Open details stay in place through the zoom, on their own layer.
      await settled()
      await evaluate('document.querySelector(\'[aria-label="协调者详情"]\').click()')
      await waitFor("Boolean(document.querySelector('.router-panel'))")
      const panelLeft = "document.querySelector('.router-panel').getBoundingClientRect().left"
      const panelStart = await evaluate(panelLeft)
      assert.ok(
        (await zoomLayers('j', { metaKey: true })).includes('::view-transition-new(router-panel)')
      )
      await waitFor("Boolean(document.querySelector('.map-view'))")
      assert.equal(await evaluate(panelLeft), panelStart)
      await press('Escape')
      await waitFor("!document.querySelector('.router-panel')")

      // A new worker grows out of its parent, branch first, and the others make room.
      await settled()
      await watchMap()
      await send('派发：新分支')
      await waitFor('window.mapMotion.grown.length > 0 && window.mapMotion.branches.length > 0')
      assert.ok(await evaluate('window.mapMotion.grown.every((count) => count > 0)'))
      assert.ok(await evaluate('window.mapMotion.branches.every((count) => count > 0)'))
      await waitFor('window.mapMotion.reshaped')
      await waitFor(() =>
        host.snapshot().workers.every((w) => ['idle', 'removed'].includes(w.status))
      )
      await settled()
      assert.deepEqual(await zoomLayers('Escape'), [
        '::view-transition-new(router-stage)',
        '::view-transition-old(router-stage)'
      ])
      await waitFor("Boolean(document.querySelector('.router-chat'))")

      // Reduced motion: the views switch directly, and nothing grows, travels, or flows.
      const inspector = window.webContents.debugger
      inspector.attach()
      await inspector.sendCommand('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
      })
      await settled()
      assert.deepEqual(await zoomLayers('j', { metaKey: true }), [])
      await waitFor("Boolean(document.querySelector('.map-view'))")
      await watchMap()
      await send('派发：安静分支')
      await waitFor(() => host.snapshot().workers.some((w) => w.title === '安静分支'))
      await waitFor(() =>
        host.snapshot().workers.every((w) => ['idle', 'removed'].includes(w.status))
      )
      await waitFor('window.mapMotion.grown.length > 0')
      assert.deepEqual(
        await evaluate(
          '[...new Set(window.mapMotion.grown.concat(window.mapMotion.branches))].concat(window.mapMotion.signals)'
        ),
        [0]
      )
      assert.deepEqual(
        await evaluate(`(() => {
          const node = getComputedStyle(document.querySelector('.map-node'))
          const edge = getComputedStyle(document.querySelector('.map-edge'))
          return [node.transitionProperty, edge.transitionProperty]
        })()`),
        ['none', 'none']
      )
      const quiet = host.snapshot().workers.find((w) => w.title === '安静分支')
      await evaluate(`document.querySelector('[data-node="${quiet.id}"]')?.click()`)
      await waitFor(
        "document.querySelector('.map-bar .router-target')?.textContent.includes('安静分支')"
      )
      await send('long')
      await waitFor(`Boolean(document.querySelector('[data-edge="${quiet.id}"] .map-flow'))`)
      assert.equal(
        await evaluate(
          `getComputedStyle(document.querySelector('[data-edge="${quiet.id}"] .map-flow')).display`
        ),
        'none'
      )
      await evaluate('document.querySelector(\'[aria-label="停止 Worker"]\').click()')
      await waitFor(`!document.querySelector('[data-edge="${quiet.id}"] .map-flow')`)
      await press('Escape')
      await press('Escape')
      await waitFor("Boolean(document.querySelector('.router-chat'))")
      await inspector.sendCommand('Emulation.setEmulatedMedia', { features: [] })
      inspector.detach()

      // Workers also run on Claude Code; requests read as that agent and activity shows up.
      assert.equal((await host.connectClaude()).status, 'ready')
      host.saveSettings({ ...host.snapshot().settings, provider: 'claude-code' })
      await window.reload()
      await waitFor("Boolean(document.querySelector('.router-editor textarea:not(:read-only)'))")
      await send('派发：Claude Worker')
      await waitFor(
        "Array.from(document.querySelectorAll('.router-dispatch')).at(-1)?.textContent.includes('Claude Worker')"
      )
      await waitFor(() =>
        host.snapshot().workers.some((w) => w.title === 'Claude Worker' && w.status === 'idle')
      )
      const claudeWorker = host.snapshot().workers.find((w) => w.title === 'Claude Worker')
      assert.equal(claudeWorker.provider, 'claude-code')
      await type('@Claude')
      await waitFor("Boolean(document.querySelector('.router-mentions button'))")
      await evaluate(
        "document.querySelector('.router-mentions button').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))"
      )
      await waitFor("Boolean(document.querySelector('.router-target'))")
      await send('claude approval')
      await waitFor(
        "document.querySelector('.router-tray .codex-request-title')?.textContent.includes('Claude Code 需要授权')"
      )
      await capture('claude-approval')
      await evaluate(
        'document.querySelector(\'.router-tray .codex-request button[type="submit"]\').click()'
      )
      await waitFor("!document.querySelector('.router-tray')")
      await waitFor(() =>
        host.snapshot().workers.some((w) => w.title === 'Claude Worker' && w.status === 'idle')
      )
      const claudeSession = host.snapshot().sessions.find((s) => s.id === claudeWorker.sessionId)
      assert.equal(claudeSession.threadId, 'claude-ui-session')
      assert.equal(claudeSession.items.find((i) => i.id === 'claude-tool').status, 'completed')
      await evaluate("document.querySelector('.router-sidebar-settings').click()")
      await waitFor(
        "Boolean(document.querySelector('.codex-settings-content')) && document.body.textContent.includes('本机 Claude Code')"
      )
      assert.ok(await evaluate("document.body.textContent.includes('claude@example.com')"))
      await capture('claude-settings')
      console.log(
        'PASS: production preload + IPC + SQLite + renderer, Router home and setup, keys, Inbox recovery, engine switch, dispatch groups, worker links, details, @ messages, approval tray, overview map, node approvals, questions, worker removal, map motion, reduced motion, Claude Code workers, theme/language, app logo, reload'
      )
      if (captureDir) console.log(`UI captures: ${captureDir}`)
    } finally {
      window?.destroy()
      host?.close()
      rmSync(temp, { recursive: true, force: true })
    }
    app.exit(0)
  })
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
