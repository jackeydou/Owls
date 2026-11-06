import { app, type BrowserWindow, ipcMain, Notification } from 'electron'
import { getSessionById, getSettingsForRenderer } from '../stores/settings-store.js'

export type MacPermissionKind = 'accessibility' | 'screen-capture' | 'notifications'

export type MacPermissionStatus =
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'not-determined'
  | 'unknown'
  | 'not-applicable'

export type PermissionsState = {
  platform: NodeJS.Platform
  accessibility: MacPermissionStatus
  screenCapture: MacPermissionStatus
  notifications: MacPermissionStatus
}

export type SystemNotificationOptions = {
  title: string
  body?: string
  subtitle?: string
  silent?: boolean
}

export type SystemNotificationResult = {
  supported: boolean
  shown: boolean
}

type RuntimeSystemNotificationOptions = SystemNotificationOptions & {
  onClick?: () => void
}

const activeNotifications = new Set<Notification>()
let getNotificationWindow: () => BrowserWindow | null = () => null

type NotificationCopyKey =
  | 'completion.chat.title'
  | 'completion.automation.title'
  | 'completion.withTitle.body'
  | 'completion.default.body'
  | 'approval.title'
  | 'approval.withTitle.body'
  | 'approval.default.body'
  | 'question.title'
  | 'question.withTitle.body'
  | 'question.default.body'

const NOTIFICATION_COPY: Record<'en' | 'zh-CN', Record<NotificationCopyKey, string>> = {
  en: {
    'completion.chat.title': 'Agent session complete',
    'completion.automation.title': 'Automation session complete',
    'completion.withTitle.body': '{title} finished. Click to open the session.',
    'completion.default.body': 'Click to open the completed session.',
    'approval.title': 'Approval needed',
    'approval.withTitle.body': '{title} needs approval to continue.',
    'approval.default.body': 'Owls needs approval to continue.',
    'question.title': 'Input needed',
    'question.withTitle.body': '{title} needs your input to continue.',
    'question.default.body': 'Owls needs your input to continue.'
  },
  'zh-CN': {
    'completion.chat.title': 'Agent 会话已完成',
    'completion.automation.title': '自动化会话已完成',
    'completion.withTitle.body': '{title} 已完成。点击打开会话。',
    'completion.default.body': '点击打开已完成的会话。',
    'approval.title': '需要审批',
    'approval.withTitle.body': '{title} 需要审批才能继续。',
    'approval.default.body': 'Owls 需要审批才能继续。',
    'question.title': '需要输入',
    'question.withTitle.body': '{title} 需要你的输入才能继续。',
    'question.default.body': 'Owls 需要你的输入才能继续。'
  }
}

function currentNotificationLanguage(): 'en' | 'zh-CN' {
  const language = getSettingsForRenderer().language
  if (language === 'zh-CN' || (language === 'auto' && app.getLocale().startsWith('zh'))) {
    return 'zh-CN'
  }
  return 'en'
}

function notificationCopy(key: NotificationCopyKey, vars?: { title?: string }): string {
  let template = NOTIFICATION_COPY[currentNotificationLanguage()][key]
  if (vars?.title) {
    template = template.replace('{title}', vars.title)
  }
  return template
}

export function setNotificationWindowGetter(getter: () => BrowserWindow | null): void {
  getNotificationWindow = getter
}

export async function sendSystemNotification(
  options: RuntimeSystemNotificationOptions
): Promise<SystemNotificationResult> {
  if (!Notification.isSupported()) {
    return { supported: false, shown: false }
  }

  const title = options.title.trim()
  if (!title) {
    throw new Error('Notification title is required')
  }

  try {
    const notification = new Notification({
      title,
      body: options.body,
      subtitle: options.subtitle,
      silent: options.silent
    })
    activeNotifications.add(notification)
    const cleanup = () => {
      activeNotifications.delete(notification)
    }
    notification.once('close', cleanup)
    notification.once('failed', cleanup)
    if (options.onClick) {
      notification.on('click', () => {
        cleanup()
        options.onClick?.()
      })
    }
    notification.show()
    return { supported: true, shown: true }
  } catch (error) {
    console.error('[notifications] failed to show notification:', error)
    return { supported: true, shown: false }
  }
}

function buildOpenSessionPayload(sessionId: string): {
  sessionId: string
  sessionKind?: 'main' | 'side'
  parentSessionId?: string | null
  cwd?: string
} {
  const entry = getSessionById(sessionId)
  return {
    sessionId,
    sessionKind: entry?.sessionKind,
    parentSessionId: entry?.parentSessionId ?? null,
    cwd: entry?.cwd
  }
}

function openSessionFromNotification(sessionId: string): void {
  const window = getNotificationWindow()
  if (!window || window.isDestroyed()) return

  if (window.isMinimized()) {
    window.restore()
  }
  if (!window.isVisible()) {
    window.show()
  }
  window.focus()

  const sendOpenSessionEvent = () => {
    if (!window.isDestroyed()) {
      window.webContents.send('app:open-session', buildOpenSessionPayload(sessionId))
    }
  }

  if (window.webContents.isLoading()) {
    window.webContents.once('did-finish-load', sendOpenSessionEvent)
    return
  }

  sendOpenSessionEvent()
}

function isNotificationWindowFocused(): boolean {
  const window = getNotificationWindow()
  return Boolean(window && !window.isDestroyed() && window.isFocused())
}

export async function sendSessionCompleteNotification(params: {
  sessionId: string
  title?: string
  source?: 'chat' | 'automation'
}): Promise<SystemNotificationResult> {
  const preference = getSettingsForRenderer().completionNotifications
  if (preference === 'never') {
    return { supported: Notification.isSupported(), shown: false }
  }
  if (preference === 'unfocused' && isNotificationWindowFocused()) {
    return { supported: Notification.isSupported(), shown: false }
  }

  const title = notificationCopy(
    params.source === 'automation' ? 'completion.automation.title' : 'completion.chat.title'
  )
  const sessionTitle = params.title?.trim()
  const body = sessionTitle
    ? notificationCopy('completion.withTitle.body', { title: sessionTitle })
    : notificationCopy('completion.default.body')

  return sendSystemNotification({
    title,
    body,
    onClick: () => openSessionFromNotification(params.sessionId)
  })
}

export async function sendSessionApprovalNotification(params: {
  sessionId: string
  title?: string
}): Promise<SystemNotificationResult> {
  if (!getSettingsForRenderer().approvalNotifications) {
    return { supported: Notification.isSupported(), shown: false }
  }

  const sessionTitle = params.title?.trim() || getSessionById(params.sessionId)?.title?.trim()
  const body = sessionTitle
    ? notificationCopy('approval.withTitle.body', { title: sessionTitle })
    : notificationCopy('approval.default.body')

  return sendSystemNotification({
    title: notificationCopy('approval.title'),
    body,
    onClick: () => openSessionFromNotification(params.sessionId)
  })
}

export async function sendSessionQuestionNotification(params: {
  sessionId: string
  title?: string
}): Promise<SystemNotificationResult> {
  if (!getSettingsForRenderer().questionNotifications) {
    return { supported: Notification.isSupported(), shown: false }
  }

  const sessionTitle = params.title?.trim() || getSessionById(params.sessionId)?.title?.trim()
  const body = sessionTitle
    ? notificationCopy('question.withTitle.body', { title: sessionTitle })
    : notificationCopy('question.default.body')

  return sendSystemNotification({
    title: notificationCopy('question.title'),
    body,
    onClick: () => openSessionFromNotification(params.sessionId)
  })
}

export function registerPermissionsIpc(): void {
  ipcMain.handle('notifications:send', (_, options: SystemNotificationOptions) =>
    sendSystemNotification(options)
  )
}

export function disposePermissions(): void {
  ipcMain.removeHandler('notifications:send')
}
