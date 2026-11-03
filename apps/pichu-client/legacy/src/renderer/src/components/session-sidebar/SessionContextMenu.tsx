import { copyTextToClipboard } from '@renderer/lib/clipboard'
import { useI18n } from '@renderer/lib/i18n'
import type { SessionIndexEntry } from '@renderer/stores/session-store'
import { type CSSProperties, forwardRef } from 'react'
import { MenuItem, MenuSeparator, MenuSurface } from '../ui/menu'

type SessionContextMenuProps = {
  entry: SessionIndexEntry
  unread: boolean
  className?: string
  style?: CSSProperties
  onClose: () => void
  onTogglePinned: (entry: SessionIndexEntry) => void
  onRename: (entry: SessionIndexEntry) => void
  onToggleUnread: (entry: SessionIndexEntry) => void
  onArchive: (entry: SessionIndexEntry) => void
}

export const SessionContextMenu = forwardRef<HTMLDivElement, SessionContextMenuProps>(
  (
    {
      entry,
      unread,
      className,
      style,
      onClose,
      onTogglePinned,
      onRename,
      onToggleUnread,
      onArchive
    },
    ref
  ) => {
    const { t } = useI18n()

    const runAction = (action: () => void | Promise<void>) => {
      onClose()
      void action()
    }

    return (
      <MenuSurface ref={ref} className={className} style={style} role="menu">
        <MenuItem
          onClick={() => {
            onClose()
            onTogglePinned(entry)
          }}
        >
          {t(entry.pinned ? 'nav.context.unpin' : 'nav.context.pin')}
        </MenuItem>
        <MenuItem
          onClick={() => {
            onClose()
            onRename(entry)
          }}
        >
          {t('nav.context.rename')}
        </MenuItem>
        <MenuItem
          onClick={() => {
            onClose()
            onToggleUnread(entry)
          }}
        >
          {t(unread ? 'nav.context.markRead' : 'nav.context.markUnread')}
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          onClick={() =>
            runAction(async () => {
              await window.api.attachments.reveal(entry.cwd)
            })
          }
        >
          {t('nav.context.openFinder')}
        </MenuItem>
        <MenuItem
          onClick={() =>
            runAction(async () => {
              await copyTextToClipboard(entry.cwd)
            })
          }
        >
          {t('nav.context.copyWorkingDirectory')}
        </MenuItem>
        <MenuItem
          onClick={() =>
            runAction(async () => {
              await copyTextToClipboard(entry.sessionId)
            })
          }
        >
          {t('nav.context.copySessionId')}
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          danger
          onClick={() => {
            onClose()
            onArchive(entry)
          }}
        >
          {t('nav.context.archive')}
        </MenuItem>
      </MenuSurface>
    )
  }
)
SessionContextMenu.displayName = 'SessionContextMenu'
