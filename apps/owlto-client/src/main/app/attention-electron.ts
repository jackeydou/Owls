import { app, BrowserWindow, Notification } from 'electron'
import type { OpenWorkerTarget } from '../../shared/app.js'
import type { AttentionDeps, AttentionNotice, NoticeHandle } from './attention.js'

/**
 * The Electron side of `WorkerAttention`: native notifications, the dock badge,
 * and whether any Owlto window has focus.
 */
export function electronAttention(
  deps: Pick<AttentionDeps, 'settings' | 'worker' | 'remote'> & {
    /** The main window, created again when the user closed it. */
    window(): BrowserWindow | null
  }
): AttentionDeps {
  // Electron drops a notification's click handler once nothing references it.
  const live = new Set<Notification>()
  return {
    ...deps,
    focused: () => BrowserWindow.getFocusedWindow() !== null,
    badge: (count) => {
      app.setBadgeCount(count)
    },
    show: (notice: AttentionNotice): NoticeHandle | null => {
      if (!Notification.isSupported()) return null
      const mac = process.platform === 'darwin'
      const notification = new Notification({
        title: notice.title,
        ...(mac
          ? { subtitle: notice.subtitle, body: notice.body }
          : { body: [notice.subtitle, notice.body].filter(Boolean).join('\n') })
      })
      const release = () => live.delete(notification)
      notification.on('click', () => {
        release()
        openWorker(deps.window(), notice.target)
      })
      notification.on('close', release)
      live.add(notification)
      notification.show()
      return {
        close: () => {
          release()
          notification.close()
        }
      }
    }
  }
}

function openWorker(window: BrowserWindow | null, target: OpenWorkerTarget): void {
  if (!window || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  if (process.platform === 'darwin') app.focus({ steal: true })
  const send = () => {
    if (!window.isDestroyed()) window.webContents.send('owlto:open-worker', target)
  }
  // A window made again for this click has not loaded the app yet.
  if (window.webContents.isLoading()) window.webContents.once('did-finish-load', send)
  else send()
}
