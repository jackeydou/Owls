import { type BrowserWindow, dialog, type IpcMainInvokeEvent, ipcMain, shell } from 'electron'
import { z } from 'zod'
import { type CodexReply, respondSchema, settingsUpdateSchema } from '../../shared/codex.js'
import {
  openRouterSchema,
  owlsProviderSchema,
  resolveBatchSchema,
  sendRouterSchema,
  setRouterKeySchema,
  workerActionSchema
} from '../../shared/router.js'
import { applyAppLogo } from './app-logo.js'
import { codexFailure } from './errors.js'
import type { OwlsHost } from './host.js'

export function registerCodexIpc(host: OwlsHost, getWindow: () => BrowserWindow | null): void {
  function handle<T>(channel: string, action: (input: unknown) => T | Promise<T>): void {
    ipcMain.handle(
      `codex:${channel}`,
      async (event: IpcMainInvokeEvent, input: unknown): Promise<CodexReply<T>> => {
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
                : codexFailure(error)
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
    return saved
  })
  handle('respond', (input) => host.respond(respondSchema.parse(input)))
  handle('router-open', (input) => host.openRouter(openRouterSchema.parse(input)))
  handle('router-send', (input) => host.sendRouter(sendRouterSchema.parse(input)))
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
  handle('cancel-sign-in', () => host.cancelSignIn())
  handle('sign-in', async () => {
    await shell.openExternal(await host.signIn())
  })
  handle('pick-project', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return result.canceled || !result.filePaths[0] ? null : host.addProject(result.filePaths[0])
  })
  handle('select-executable', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile', 'showHiddenFiles'] })
    if (result.canceled || !result.filePaths[0]) return null
    host.saveSettings({ ...host.snapshot().settings, executablePath: result.filePaths[0] })
    return host.connect()
  })
  handle('select-claude-executable', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile', 'showHiddenFiles'] })
    if (result.canceled || !result.filePaths[0]) return null
    host.saveSettings({ ...host.snapshot().settings, claudeExecutablePath: result.filePaths[0] })
    return host.connectClaude()
  })
}
