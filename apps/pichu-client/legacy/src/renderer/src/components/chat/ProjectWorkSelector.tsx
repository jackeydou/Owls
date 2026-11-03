import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemCheck,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { useI18n } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { ChevronDown, Folder, FolderPlus, FolderX, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ProjectEntry } from '../../../../preload/index.d'

export function ProjectWorkSelector({
  projects,
  currentProject,
  disabled,
  onSelectProject,
  onAddProject,
  onWorkLocally
}: {
  projects: ProjectEntry[]
  currentProject: ProjectEntry | null
  disabled: boolean
  onSelectProject: (project: ProjectEntry) => void
  onAddProject: () => void
  onWorkLocally: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const filteredProjects = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return projects
    return projects.filter(
      (project) =>
        project.name.toLowerCase().includes(needle) || project.path.toLowerCase().includes(needle)
    )
  }, [projects, query])

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) setQuery('')
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'inline-flex h-7 max-w-56 items-center gap-1.5 rounded-full px-2 text-[13px] leading-none text-muted-foreground transition hover:bg-card-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
            open && 'bg-card-muted text-foreground',
            currentProject && !open && 'text-foreground'
          )}
          aria-label={t('chat.projectPicker.label')}
        >
          <Folder className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span className="truncate">
            {currentProject?.name ?? t('chat.projectPicker.workInProject')}
          </span>
          <ChevronDown className="size-3.5 shrink-0" strokeWidth={1.75} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="bottom" sideOffset={5} className="w-64">
        <div className="flex h-7 items-center gap-2 rounded-lg px-2.5 text-muted-foreground">
          <Search className="size-3.5 shrink-0" strokeWidth={1.75} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            placeholder={t('chat.projectPicker.search')}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
            aria-label={t('chat.projectPicker.search')}
          />
        </div>
        <div className="max-h-[13.5rem] overflow-y-auto">
          {filteredProjects.length > 0 ? (
            filteredProjects.map((project) => {
              const selected = currentProject?.path === project.path
              return (
                <DropdownMenuItem
                  key={project.path}
                  selected={selected}
                  onSelect={() => onSelectProject(project)}
                >
                  <Folder className="size-3.5 shrink-0" strokeWidth={1.75} />
                  <span className="min-w-0 flex-1 truncate">{project.name}</span>
                  <DropdownMenuItemCheck visible={selected} />
                </DropdownMenuItem>
              )
            })
          ) : (
            <div className="px-2.5 py-1.5 text-[13px] text-muted-foreground">
              {t('chat.projectPicker.noResults')}
            </div>
          )}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onAddProject}>
          <FolderPlus className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span>{t('chat.projectPicker.addProject')}</span>
        </DropdownMenuItem>
        <DropdownMenuItem selected={!currentProject} onSelect={onWorkLocally}>
          <FolderX className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate">{t('chat.projectPicker.noProject')}</span>
          <DropdownMenuItemCheck visible={!currentProject} />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
