import { type BrowserWindow, dialog, type IpcMainInvokeEvent, ipcMain, shell } from 'electron'
import { z } from 'zod'
import {
  type CodexReply,
  createSessionSchema,
  respondSchema,
  sendSchema,
  settingsUpdateSchema
} from '../../shared/codex.js'
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
  handle('settings', (input) =>
    host.saveSettings({
      ...host.snapshot().settings,
      ...settingsUpdateSchema.parse(input)
    })
  )
  handle('create-session', (input) => host.createSession(createSessionSchema.parse(input)))
  handle('send', (input) => host.send(sendSchema.parse(input)))
  handle('interrupt', (input) => host.interrupt(z.string().uuid().parse(input)))
  handle('respond', (input) => host.respond(respondSchema.parse(input)))
  handle('archive', async (input) => {
    const id = z.string().uuid().parse(input)
    const chinese = host.snapshot().settings.language === 'zh-CN'
    const agent = host.provider(id) === 'claude-code' ? 'Claude Code' : 'Codex'
    const result = await dialog.showMessageBox({
      type: 'question',
      message: chinese ? '移除此任务？' : 'Remove this task?',
      detail: chinese
        ? `这会移除 Owls 中的任务记录，${agent} 原生历史不受影响。`
        : `This removes the task from Owls. Native ${agent} history stays in ${agent}.`,
      buttons: chinese ? ['取消', '移除'] : ['Cancel', 'Remove'],
      defaultId: 0,
      cancelId: 0
    })
    if (result.response === 1) host.archive(id)
  })
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
