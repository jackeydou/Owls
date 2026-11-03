const assert = require('node:assert/strict')
const { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { app, BrowserWindow } = require('electron')
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
const captureIndex = process.argv.indexOf('--capture-dir')
const captureDir = captureIndex >= 0 ? process.argv[captureIndex + 1] : null
app.disableHardwareAcceleration()

app
  .whenReady()
  .then(async () => {
    const temp = mkdtempSync(join(tmpdir(), 'owls-codex-ui-'))
    let window
    let host
    let router
    const evaluate = (source) => window.webContents.executeJavaScript(source)
    const waitFor = async (expression) => {
      const deadline = Date.now() + 12_000
      while (!(await evaluate(expression))) {
        assert.ok(Date.now() < deadline, `Timed out waiting for UI: ${expression}`)
        await new Promise((resolve) => setTimeout(resolve, 30))
      }
    }
    const send = async (text) => {
      await evaluate(`(() => {
      const input = document.querySelector('.codex-composer textarea')
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(text)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
      await waitFor("document.querySelector('.codex-send')?.disabled === false")
      await evaluate("document.querySelector('.codex-send').click()")
    }
    const capture = async (name) => {
      if (!captureDir) return
      mkdirSync(captureDir, { recursive: true })
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
      const startRouter = () =>
        new RouterService(
          routerStore,
          credentials,
          store,
          host.workerHost(),
          emit,
          defaultEngineFactory({
            credentials,
            claude: { sdk: claudeSdk, connection: () => host.claudeConnection() }
          })
        )
      router = startRouter()
      host.attachRouter(router)
      host.addProject(temp)
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
      await waitFor("Boolean(document.querySelector('.codex-composer textarea:not(:disabled)'))")
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

      await send('tools')
      await waitFor(
        "document.querySelector('.codex-assistant-message')?.textContent.includes('hello world')"
      )
      assert.equal(await evaluate("document.querySelectorAll('.codex-user-message').length"), 1)
      assert.equal(await evaluate("document.querySelectorAll('.codex-activity').length"), 3)
      await evaluate("document.querySelector('.codex-topbar-actions button').click()")
      await waitFor(
        "document.querySelector('.codex-diff-pane pre')?.textContent.includes('hello world')"
      )
      await evaluate(
        "Array.from(document.querySelectorAll('.codex-activity summary')).find(el => el.textContent.includes('Command')).click()"
      )
      await capture('chat')
      await evaluate('document.querySelector(\'[aria-label="Close changes"]\').click()')

      await send('approval')
      await waitFor("Boolean(document.querySelector('.codex-request'))")
      await capture('approval')
      await evaluate(
        "Array.from(document.querySelectorAll('.codex-request button')).find(el => el.textContent === 'Decline').click()"
      )
      await waitFor("!document.querySelector('.codex-request')")
      await send('question')
      await waitFor('Boolean(document.querySelector(\'.codex-request input[type="radio"]\'))')
      await evaluate('document.querySelector(\'.codex-request input[type="radio"]\').click()')
      await waitFor(
        'document.querySelector(\'.codex-request button[type="submit"]\').disabled === false'
      )
      await evaluate('document.querySelector(\'.codex-request button[type="submit"]\').click()')
      await waitFor("!document.querySelector('.codex-request')")

      await evaluate("document.querySelector('.codex-sidebar-settings').click()")
      await waitFor("Boolean(document.querySelector('.codex-settings-content'))")
      assert.ok(
        await evaluate(
          "document.querySelector('.codex-account-info').textContent.includes('fixture@example.com')"
        )
      )
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
      await capture('settings')

      await window.reload()
      await waitFor("Boolean(document.querySelector('.codex-task-select'))")
      await evaluate("document.querySelector('.codex-task-select').click()")
      await waitFor(
        "document.querySelector('.codex-assistant-message')?.textContent.includes('hello world')"
      )
      assert.equal(await evaluate("document.querySelectorAll('.codex-user-message').length"), 3)
      assert.equal(await evaluate("document.querySelectorAll('.codex-request').length"), 0)

      assert.equal((await host.connectClaude()).status, 'ready')
      await evaluate("document.querySelector('.codex-new-task').click()")
      await waitFor("Boolean(document.querySelector('.codex-composer select'))")
      await evaluate(
        "(() => { const agent = document.querySelector('.codex-composer select'); agent.value = 'claude-code'; agent.dispatchEvent(new Event('change', { bubbles: true })) })()"
      )
      await waitFor(
        "document.querySelector('.codex-composer textarea')?.placeholder.includes('Claude Code')"
      )
      assert.equal(host.snapshot().settings.provider, 'claude-code')
      await send('claude hello')
      await waitFor(
        "document.querySelector('.codex-assistant-message')?.textContent.includes('claude says hi')"
      )
      assert.ok(
        await evaluate(
          "document.querySelector('.codex-task-row.selected small').textContent.includes('Claude Code')"
        )
      )
      assert.equal(
        await evaluate("document.querySelector('.codex-message-label').textContent"),
        'Claude Code'
      )
      await send('claude approval')
      await waitFor(
        "document.querySelector('.codex-request-title')?.textContent.includes('Claude Code 需要授权')"
      )
      await capture('claude-approval')
      await evaluate('document.querySelector(\'.codex-request button[type="submit"]\').click()')
      await waitFor("!document.querySelector('.codex-request')")
      await waitFor(
        "Array.from(document.querySelectorAll('.codex-activity')).some(el => el.textContent.includes('ls -la'))"
      )
      const claudeSession = host.snapshot().sessions.find((s) => s.provider === 'claude-code')
      assert.equal(claudeSession.threadId, 'claude-ui-session')
      assert.equal(claudeSession.items.find((i) => i.id === 'claude-tool').status, 'completed')
      await evaluate("document.querySelector('.codex-sidebar-settings').click()")
      await waitFor(
        "Boolean(document.querySelector('.codex-settings-content')) && document.body.textContent.includes('本机 Claude Code')"
      )
      assert.ok(await evaluate("document.body.textContent.includes('claude@example.com')"))
      await capture('claude-settings')

      // Router: an unconfigured Owls engine shows setup, and keys never come back out.
      assert.ok(await evaluate("document.body.textContent.includes('协调者引擎')"))
      await evaluate("document.querySelector('.codex-router-entry').click()")
      await waitFor(
        "Boolean(document.querySelector('.router-view')) && document.body.textContent.includes('为协调者选择模型')"
      )
      await send('帮我看看项目')
      await waitFor(
        "Array.from(document.querySelectorAll('.router-view .codex-user-message')).some(el => el.textContent.includes('帮我看看项目'))"
      )
      await waitFor("document.querySelector('.router-view textarea')?.value === ''")
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
      await waitFor("Boolean(document.querySelector('.codex-router-entry'))")
      await evaluate("document.querySelector('.codex-router-entry').click()")
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

      // Choosing the Claude Code engine changes the Router header and drops the Owls fields.
      await evaluate("document.querySelector('.codex-sidebar-settings').click()")
      await waitFor("Boolean(document.querySelector('#router-engine'))")
      await evaluate(
        "document.querySelector('#router-engine').value = 'claude-code'; document.querySelector('#router-engine').dispatchEvent(new Event('change', { bubbles: true }))"
      )
      await waitFor(
        "Boolean(document.querySelector('#router-claude-model')) && !document.querySelector('#router-provider')"
      )
      assert.equal(host.snapshot().settings.router.engine, 'claude-code')
      await capture('router-claude-settings')
      await evaluate("document.querySelector('.codex-router-entry').click()")
      await waitFor("document.querySelector('.router-model')?.textContent.includes('Claude Code')")
      console.log(
        'PASS: production preload + IPC + SQLite + renderer, messages, tools/diff, approvals, questions, local account reconnect, theme/language, reload, Claude Code tasks, Router setup and keys, Router Inbox recovery, engine switch'
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
