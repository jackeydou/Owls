import { useI18n } from '@renderer/lib/i18n'
import { FolderOpen, Pin, SquarePen, X } from 'lucide-react'
import { type CSSProperties, forwardRef } from 'react'
import type { ProjectEntry } from '../../../../preload/index.d'
import { MenuItem, MenuSeparator, MenuSurface } from '../ui/menu'

type ProjectContextMenuProps = {
  project: ProjectEntry
  className?: string
  style?: CSSProperties
  onClose: () => void
  onTogglePinned: (project: ProjectEntry) => void
  onOpenFinder: (project: ProjectEntry) => void
  onRename: (project: ProjectEntry) => void
  onRemove: (project: ProjectEntry) => void
}

export const ProjectContextMenu = forwardRef<HTMLDivElement, ProjectContextMenuProps>(
  (
    { project, className, style, onClose, onTogglePinned, onOpenFinder, onRename, onRemove },
    ref
  ) => {
    const { t } = useI18n()

    const runAction = (action: () => void) => {
      onClose()
      action()
    }

    return (
      <MenuSurface ref={ref} className={className} style={style} role="menu">
        <MenuItem onClick={() => runAction(() => onTogglePinned(project))}>
          <Pin className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span>{t(project.pinned ? 'nav.projectUnpin' : 'nav.projectPin')}</span>
        </MenuItem>
        <MenuItem onClick={() => runAction(() => onOpenFinder(project))}>
          <FolderOpen className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span>{t('nav.context.openFinder')}</span>
        </MenuItem>
        <MenuItem onClick={() => runAction(() => onRename(project))}>
          <SquarePen className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span>{t('nav.projectRename')}</span>
        </MenuItem>
        <MenuSeparator />
        <MenuItem danger onClick={() => runAction(() => onRemove(project))}>
          <X className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span>{t('nav.projectRemove')}</span>
        </MenuItem>
      </MenuSurface>
    )
  }
)
ProjectContextMenu.displayName = 'ProjectContextMenu'
