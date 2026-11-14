import { cn } from '@renderer/lib/utils'
import { Archive, CircleAlert, Clock3, Loader2, Pin } from 'lucide-react'
import { memo, useEffect, useRef } from 'react'
import { SidebarMenuItem, useSidebar } from '../ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { formatRelativeTime, type SessionSortKey } from './sidebar-utils'

export type SessionItemStatus = {
  isRunning: boolean
  isAwaitingApproval: boolean
  isUnread: boolean
  isFailed: boolean
}

type SessionItemProps = {
  sessionId: string
  agentId: string
  title: string
  createdAt: string
  updatedAt: string
  sortKey: SessionSortKey
  isActive: boolean
  isContextMenuOpen: boolean
  confirmRemove: boolean
  isRunning: boolean
  isAwaitingApproval: boolean
  isUnread: boolean
  isFailed: boolean
  isPinned: boolean
  isProjectChild?: boolean
  isDragging?: boolean
  isRenaming: boolean
  renameValue: string
  onRemove: (sessionId: string) => void
  onConfirmRemove: (sessionId: string) => void
  onContextMenu: (sessionId: string, event: React.MouseEvent) => void
  onRenameCancel: () => void
  onRenameSubmit: (sessionId: string, title: string) => void
  onRenameValueChange: (value: string) => void
  onUnpin: (sessionId: string) => void
  onSelect: (sessionId: string, isPinned: boolean, status: SessionItemStatus) => void
  removeLabel: string
  confirmRemoveLabel: string
  runningLabel: string
  awaitingApprovalLabel: string
  unreadLabel: string
  failedLabel: string
  pinnedLabel: string
}

function SessionItemBase({
  sessionId,
  agentId,
  title,
  createdAt,
  updatedAt,
  sortKey,
  isActive,
  isContextMenuOpen,
  confirmRemove,
  isRunning,
  isAwaitingApproval,
  isUnread,
  isFailed,
  isPinned,
  isProjectChild = false,
  isDragging,
  isRenaming,
  renameValue,
  onRemove,
  onConfirmRemove,
  onContextMenu,
  onRenameCancel,
  onRenameSubmit,
  onRenameValueChange,
  onUnpin,
  onSelect,
  removeLabel,
  confirmRemoveLabel,
  runningLabel,
  awaitingApprovalLabel,
  unreadLabel,
  failedLabel,
  pinnedLabel
}: SessionItemProps): React.JSX.Element {
  const { collapsed } = useSidebar()
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const displayTitle = title || sessionId
  const isAutomationSession = agentId.startsWith('automation:')
  const selectSession = () =>
    onSelect(sessionId, isPinned, { isRunning, isAwaitingApproval, isUnread, isFailed })

  useEffect(() => {
    if (!isRenaming) return
    requestAnimationFrame(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    })
  }, [isRenaming])

  if (collapsed) {
    return (
      <SidebarMenuItem
        active={isActive || isContextMenuOpen}
        title={displayTitle}
        onClick={selectSession}
        onContextMenu={(event) => onContextMenu(sessionId, event)}
        className={cn(
          'cursor-default select-none [contain-intrinsic-size:32px] [content-visibility:auto]',
          isDragging && 'opacity-45'
        )}
      >
        {isAwaitingApproval ? (
          <Loader2
            className="size-3 shrink-0 animate-spin text-muted-foreground"
            strokeWidth={1.8}
            aria-label={awaitingApprovalLabel}
          />
        ) : isRunning ? (
          <Loader2
            className="size-3 shrink-0 animate-spin text-muted-foreground"
            strokeWidth={1.8}
            aria-label={runningLabel}
          />
        ) : isFailed ? (
          <CircleAlert
            className="size-3 shrink-0 text-destructive"
            strokeWidth={2}
            aria-label={failedLabel}
          />
        ) : isAutomationSession ? (
          <Clock3 className="size-3 shrink-0" strokeWidth={1.8} />
        ) : isPinned ? (
          <Pin
            className="size-3 shrink-0 text-muted-foreground"
            strokeWidth={1.8}
            aria-label={pinnedLabel}
          />
        ) : isUnread ? (
          <span
            className="size-2 rounded-full bg-blue-500"
            title={unreadLabel}
            role="status"
            aria-label={unreadLabel}
          />
        ) : (
          <span className="max-w-5 truncate text-[10px] font-medium">
            {(displayTitle || sessionId).slice(0, 2)}
          </span>
        )}
      </SidebarMenuItem>
    )
  }

  return (
    <SidebarMenuItem
      active={isActive || isContextMenuOpen}
      onClick={selectSession}
      onContextMenu={(event) => onContextMenu(sessionId, event)}
      className={cn(
        'h-8 cursor-default select-none rounded-lg px-3 py-0 text-[14px] [contain-intrinsic-size:32px] [content-visibility:auto]',
        isProjectChild && 'pl-[34px]',
        isDragging && 'opacity-45'
      )}
    >
      {isRenaming ? (
        <form
          className="flex min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault()
            onRenameSubmit(sessionId, renameValue)
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(event) => onRenameValueChange(event.target.value)}
            onBlur={() => onRenameSubmit(sessionId, renameValue)}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                onRenameCancel()
              }
            }}
            className="h-7 min-w-0 flex-1 rounded-md border border-border/80 bg-background px-2 text-[14px] text-foreground outline-none focus:border-border-strong focus:ring-1 focus:ring-border-strong"
            aria-label={displayTitle}
          />
        </form>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {isPinned ? (
            <Tooltip>
              <TooltipTrigger
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  onUnpin(sessionId)
                }}
                className="-ml-1 flex size-6 shrink-0 items-center justify-center text-muted-foreground/70 transition hover:text-foreground"
                aria-label={pinnedLabel}
              >
                <Pin className="size-3.5" strokeWidth={1.75} />
              </TooltipTrigger>
              <TooltipContent side="right">{pinnedLabel}</TooltipContent>
            </Tooltip>
          ) : isFailed ? (
            <CircleAlert
              className="size-3.5 shrink-0 text-destructive"
              strokeWidth={2}
              aria-label={failedLabel}
            />
          ) : isAutomationSession ? (
            <Clock3 className="size-3.5 shrink-0 text-muted-foreground/70" strokeWidth={1.75} />
          ) : null}
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-left leading-8',
              isActive ? 'text-foreground' : 'text-foreground/92'
            )}
            title={displayTitle}
          >
            {displayTitle || sessionId.slice(0, 16)}
          </span>
          {isAwaitingApproval ? (
            <span className="ml-1 shrink-0 rounded-full bg-green-500/16 px-2 py-0.5 text-[12px] font-medium leading-4 text-green-600 dark:bg-green-500/20 dark:text-green-300">
              {awaitingApprovalLabel}
            </span>
          ) : null}
        </div>
      )}
      <div
        className={cn(
          'relative ml-2 flex h-8 shrink-0 items-center justify-end',
          confirmRemove ? 'w-[58px]' : 'w-7'
        )}
      >
        {confirmRemove ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onConfirmRemove(sessionId)
            }}
            className="rounded-full bg-red-500/10 px-2.5 py-0.5 text-[12px] font-medium leading-5 text-red-600 transition hover:bg-red-500/15 hover:text-red-700 dark:bg-red-500/15 dark:text-red-300 dark:hover:bg-red-500/20 dark:hover:text-red-200"
            title={confirmRemoveLabel}
            aria-label={confirmRemoveLabel}
          >
            {confirmRemoveLabel}
          </button>
        ) : (
          <>
            {isAwaitingApproval ? (
              <span
                className="flex h-8 items-center justify-end text-muted-foreground/75 transition-opacity group-hover:opacity-0"
                title={awaitingApprovalLabel}
                role="status"
                aria-label={awaitingApprovalLabel}
              >
                <Loader2 className="size-3.5 animate-spin" strokeWidth={1.8} />
              </span>
            ) : isRunning ? (
              <span
                className="flex h-8 items-center justify-end text-muted-foreground/75 transition-opacity group-hover:opacity-0"
                title={runningLabel}
                role="status"
                aria-label={runningLabel}
              >
                <Loader2 className="size-3.5 animate-spin" strokeWidth={1.8} />
              </span>
            ) : isUnread ? (
              <span
                className="flex h-8 items-center justify-end transition-opacity group-hover:opacity-0"
                title={unreadLabel}
                role="status"
                aria-label={unreadLabel}
              >
                <span className="mr-[3px] size-2 rounded-full bg-blue-500" />
              </span>
            ) : (
              <span className="text-[13px] leading-8 text-muted-foreground/75 transition-opacity group-hover:opacity-0">
                {formatRelativeTime(sortKey === 'created' ? createdAt : updatedAt || createdAt)}
              </span>
            )}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onRemove(sessionId)
              }}
              className="absolute inset-y-0 right-[-5px] flex w-7 items-center justify-center text-muted-foreground/0 opacity-0 transition hover:text-foreground/80 group-hover:text-muted-foreground/55 group-hover:opacity-100"
              title={removeLabel}
              aria-label={removeLabel}
            >
              <Archive className="size-3.5" strokeWidth={1.8} />
            </button>
          </>
        )}
      </div>
    </SidebarMenuItem>
  )
}

export const SessionItem = memo(SessionItemBase)
SessionItem.displayName = 'SessionItem'
