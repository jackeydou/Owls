const assert = require('node:assert/strict')
const { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { app, BrowserWindow } = require('electron')
const packageIndex = process.argv.indexOf('--packaged-app')
const resources =
  packageIndex >= 0 ? join(resolve(process.argv[packageIndex + 1]), 'Contents/Resources') : null
const artifactRoot = resources ? join(resources, 'app.asar') : resolve(__dirname, '../..')
const { CodexService, CodexStore } = require(join(artifactRoot, 'out/main/codex/runtime.js'))
const { registerCodexIpc } = require(join(artifactRoot, 'out/main/codex/ipc.js'))

const captureIndex = process.argv.indexOf('--capture-dir')
const captureDir = captureIndex >= 0 ? process.argv[captureIndex + 1] : null
app.disableHardwareAcceleration()

app
  .whenReady()
  .then(async () => {
    const temp = mkdtempSync(join(tmpdir(), 'owls-codex-ui-'))
    let window
    let host
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
      store.saveSettings({ ...store.settings(), executablePath: fixture })
      host = new CodexService(store, (event) => {
        if (window && !window.isDestroyed()) window.webContents.send('codex:event', event)
      })
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
      console.log(
        'PASS: production preload + IPC + SQLite + renderer, messages, tools/diff, approvals, questions, local account reconnect, theme/language, reload'
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
