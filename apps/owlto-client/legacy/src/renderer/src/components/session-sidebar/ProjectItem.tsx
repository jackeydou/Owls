import { useI18n } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { ChevronDown, Folder, FolderOpen, MoreHorizontal, Pin, SquarePen, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ProjectEntry } from '../../../../preload/index.d'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '../ui/dropdown-menu'
import { SidebarMenuItem } from '../ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

export function ProjectItem({
  project,
  collapsed: sidebarCollapsed,
  expanded,
  isContextMenuOpen,
  isRenaming,
  renameValue,
  onOpenFinder,
  onRemove,
  onContextMenu,
  onRenameCancel,
  onRenameSubmit,
  onRenameValueChange,
  onStartChat,
  onStartRename,
  onTogglePinned,
  onToggle
}: {
  project: ProjectEntry
  collapsed: boolean
  expanded: boolean
  isContextMenuOpen: boolean
  isRenaming: boolean
  renameValue: string
  onOpenFinder: (project: ProjectEntry) => void
  onRemove: (project: ProjectEntry) => void
  onContextMenu: (project: ProjectEntry, event: React.MouseEvent) => void
  onRenameCancel: () => void
  onRenameSubmit: (project: ProjectEntry, name: string) => void
  onRenameValueChange: (value: string) => void
  onStartChat: (project: ProjectEntry) => void
  onStartRename: (project: ProjectEntry) => void
  onTogglePinned: (project: ProjectEntry) => void
  onToggle: (project: ProjectEntry) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const preserveFocusAfterMenuCloseRef = useRef(false)
  const Icon = expanded ? FolderOpen : Folder
  const startChatLabel = t('nav.startChatInProject', { project: project.name })

  useEffect(() => {
    if (isRenaming) {
      requestAnimationFrame(() => {
        renameInputRef.current?.focus()
        renameInputRef.current?.select()
      })
    }
  }, [isRenaming])

  if (sidebarCollapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => onStartChat(project)}
            onContextMenu={(event) => onContextMenu(project, event)}
            className={cn(
              'mx-auto flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-sidebar-hover hover:text-foreground',
              isContextMenuOpen && 'bg-sidebar-active text-foreground'
            )}
            aria-label={project.name}
          >
            <Icon className="size-3.5" strokeWidth={1.75} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{project.name}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <SidebarMenuItem
      active={isContextMenuOpen}
      onClick={() => onToggle(project)}
      onContextMenu={(event) => onContextMenu(project, event)}
      className="group/project min-h-8 cursor-default select-none py-0 pr-4 pl-3 text-[14px] text-foreground/92"
    >
      <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
      {isRenaming ? (
        <form
          className="flex min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault()
            onRenameSubmit(project, renameValue)
          }}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={(event) => onRenameValueChange(event.target.value)}
            onBlur={() => onRenameSubmit(project, renameValue)}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                onRenameCancel()
              }
            }}
            className="h-7 min-w-0 flex-1 select-text rounded-md border border-border/80 bg-background px-2 text-[14px] text-foreground outline-none focus:border-border-strong focus:ring-1 focus:ring-border-strong"
            aria-label={t('nav.projectRename')}
          />
        </form>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <span className="min-w-0 truncate text-left leading-8">{project.name}</span>
          <span
            className={cn(
              'flex size-5 shrink-0 items-center justify-center text-foreground/92 opacity-0 transition-opacity group-hover/project:opacity-100',
              isContextMenuOpen && 'opacity-100'
            )}
            aria-hidden="true"
          >
            <ChevronDown
              className={cn('size-3.5 shrink-0 transition-transform', !expanded && '-rotate-90')}
              strokeWidth={1.8}
            />
          </span>
        </div>
      )}
      <div className="-mr-2 flex shrink-0 items-center gap-0.5">
        <DropdownMenu open={actionsMenuOpen} onOpenChange={setActionsMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={(event) => event.stopPropagation()}
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-md text-foreground/92 opacity-0 transition hover:bg-sidebar-hover focus-visible:opacity-100 group-hover/project:opacity-100',
                (actionsMenuOpen || isContextMenuOpen) && 'opacity-100'
              )}
              aria-label={t('nav.projectActions')}
            >
              <MoreHorizontal className="size-3" strokeWidth={1.75} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            side="bottom"
            className="w-56"
            onCloseAutoFocus={(event) => {
              if (!preserveFocusAfterMenuCloseRef.current) return
              preserveFocusAfterMenuCloseRef.current = false
              event.preventDefault()
            }}
          >
            <DropdownMenuItem
              onSelect={() => {
                onTogglePinned(project)
              }}
              className="text-foreground/90"
            >
              <Pin className="size-3.5 shrink-0" strokeWidth={1.75} />
              <span>{t(project.pinned ? 'nav.projectUnpin' : 'nav.projectPin')}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                onOpenFinder(project)
              }}
              className="text-foreground/90"
            >
              <FolderOpen className="size-3.5 shrink-0" strokeWidth={1.75} />
              <span>{t('nav.context.openFinder')}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                preserveFocusAfterMenuCloseRef.current = true
                onStartRename(project)
              }}
              className="text-foreground/90"
            >
              <SquarePen className="size-3.5 shrink-0" strokeWidth={1.75} />
              <span>{t('nav.projectRename')}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              danger
              onSelect={() => {
                onRemove(project)
              }}
            >
              <X className="size-3.5 shrink-0" strokeWidth={1.75} />
              <span>{t('nav.projectRemove')}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onStartChat(project)
              }}
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-md text-foreground/92 opacity-0 transition hover:bg-sidebar-hover focus-visible:opacity-100 group-hover/project:opacity-100',
                isContextMenuOpen && 'opacity-100'
              )}
              aria-label={startChatLabel}
            >
              <SquarePen className="size-3" strokeWidth={1.75} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={6}>
            {startChatLabel}
          </TooltipContent>
        </Tooltip>
      </div>
    </SidebarMenuItem>
  )
}
