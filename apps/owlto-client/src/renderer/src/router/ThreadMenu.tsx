import { ArchiveIcon, PencilIcon, PinIcon, PinOffIcon } from '@renderer/components/ui/icons'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@renderer/components/ui/menu'
import { type MouseEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Router } from '../../../shared/app'
import { useAppStore } from '../app/store'
import { threadTitle, useThreadTitle } from './activity'
import { useRouterStore } from './store'

type Point = { x: number; y: number }

/**
 * The right-click menu of a sidebar thread: Pin, Rename, and Archive. It opens where the
 * pointer is, or under the row when the menu key or Shift-F10 opened it.
 */
export function useThreadMenu() {
  const [point, setPoint] = useState<Point | null>(null)
  const row = useRef<HTMLElement | null>(null)
  const onContextMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault()
    row.current = event.currentTarget
    const fromKeyboard = event.button !== 2 && event.clientX === 0 && event.clientY === 0
    if (!fromKeyboard) return setPoint({ x: event.clientX, y: event.clientY })
    const box = event.currentTarget.getBoundingClientRect()
    setPoint({ x: box.left + 8, y: box.bottom })
  }
  return { point, row, close: () => setPoint(null), onContextMenu }
}

export function ThreadMenu({
  thread,
  point,
  row,
  onClose,
  onRename
}: {
  thread: Router
  point: Point | null
  /** The row the menu opened from, which gets focus back when it closes. */
  row: { current: HTMLElement | null }
  onClose: () => void
  onRename: () => void
}) {
  const renaming = useRef(false)
  const pointer = useRef(false)
  const { t } = useTranslation()
  const untitled = useThreadTitle()
  const pin = useRouterStore((s) => s.pin)
  const archive = useRouterStore((s) => s.archive)
  const pinned = thread.pinnedAt !== null
  return (
    <Menu open={point !== null} onOpenChange={(open) => (open ? null : onClose())} modal={false}>
      <MenuTrigger asChild>
        <span
          aria-hidden
          className="thread-menu-anchor"
          style={point ? { left: point.x, top: point.y } : undefined}
        />
      </MenuTrigger>
      <MenuContent
        align="start"
        side="bottom"
        sideOffset={2}
        className="min-w-[168px]"
        aria-label={t('threadActions.menu', { title: threadTitle(thread, untitled) })}
        onPointerDown={() => {
          pointer.current = true
        }}
        onKeyDown={() => {
          pointer.current = false
        }}
        onCloseAutoFocus={(event) => {
          // The anchor can't hold focus. A keyboard close hands it back to the row; a rename
          // leaves it with the field, and a pointer choice leaves it alone (no focus ring).
          event.preventDefault()
          if (!renaming.current && !pointer.current) row.current?.focus({ preventScroll: true })
          renaming.current = false
          pointer.current = false
        }}
      >
        <MenuItem onSelect={() => void pin(thread.id, !pinned)}>
          {pinned ? <PinOffIcon size={15} /> : <PinIcon size={15} />}
          {t(pinned ? 'threadActions.unpin' : 'threadActions.pin')}
        </MenuItem>
        <MenuItem
          onSelect={() => {
            renaming.current = true
            onRename()
          }}
        >
          <PencilIcon size={15} />
          {t('threadActions.rename')}
        </MenuItem>
        <MenuItem
          onSelect={async () => {
            const open = useAppStore.getState()
            const current = open.view === 'chat' && open.threadId === thread.id
            // Archiving the open thread starts a new one in its place.
            if ((await archive(thread.id, true)) && current) open.newThread()
          }}
        >
          <ArchiveIcon size={15} />
          {t('archives.archive')}
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}
