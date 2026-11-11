import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { IconButton } from '@renderer/components/ui/icon-button'
import {
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  GlobeIcon,
  LoaderIcon,
  PlusIcon
} from '@renderer/components/ui/icons'
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger
} from '@renderer/components/ui/menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Failure } from '../../../shared/app'
import { parseGitHubRepo, projectNameSchema } from '../../../shared/projects'
import { failureMessage } from '../app/failures'
import { useAppStore } from '../app/store'
import { useRouterStore } from './store'

/** Projects offered under Recents; the rest are in the sidebar list. */
const RECENT_LIMIT = 5

type Source = 'github' | 'quick'

/** Projects by their latest thread activity, most recent first; untouched ones last. */
function useRecentProjects() {
  const projects = useAppStore((s) => s.projects)
  const routers = useRouterStore((s) => s.routers)
  return useMemo(() => {
    const latest = new Map<string, string>()
    for (const router of routers) {
      if (!router.projectId) continue
      const seen = latest.get(router.projectId)
      if (!seen || router.updatedAt > seen) latest.set(router.projectId, router.updatedAt)
    }
    return projects
      .filter((project) => latest.has(project.id))
      .sort(
        (a, b) =>
          (latest.get(b.id) ?? '').localeCompare(latest.get(a.id) ?? '') ||
          a.name.localeCompare(b.name)
      )
      .slice(0, RECENT_LIMIT)
  }, [projects, routers])
}

/**
 * The Projects sidebar's add button: a menu to open a folder, import a GitHub
 * repository, or start an empty project, with recent projects below.
 */
export function AddProjectMenu() {
  const { t } = useTranslation()
  const pickProject = useAppStore((s) => s.pickProject)
  const showChat = useAppStore((s) => s.showChat)
  const recents = useRecentProjects()
  const [source, setSource] = useState<Source | null>(null)
  // A form opening from the menu keeps its focus instead of returning it to the button.
  const keepFocus = useRef(false)
  const open = (next: Source) => {
    keepFocus.current = true
    setSource(next)
  }
  return (
    <>
      <Menu>
        <Tooltip>
          <TooltipTrigger asChild>
            <MenuTrigger asChild>
              <IconButton size="sm" label={t('addProject')} icon={<PlusIcon size={14} />} />
            </MenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('addProject')}</TooltipContent>
        </Tooltip>
        <MenuContent
          align="end"
          onCloseAutoFocus={(event) => {
            if (keepFocus.current) event.preventDefault()
            keepFocus.current = false
          }}
        >
          <MenuItem onSelect={() => void pickProject()}>
            <FolderOpenIcon size={15} aria-hidden />
            {t('project.add.open')}
          </MenuItem>
          <MenuItem onSelect={() => open('github')}>
            <GlobeIcon size={15} aria-hidden />
            {t('project.add.github')}
          </MenuItem>
          <MenuItem onSelect={() => open('quick')}>
            <FolderPlusIcon size={15} aria-hidden />
            {t('project.add.quick')}
          </MenuItem>
          {recents.length ? (
            <>
              <MenuSeparator />
              <MenuGroup>
                <MenuLabel>{t('project.add.recents')}</MenuLabel>
                {recents.map((project) => (
                  <MenuItem key={project.id} onSelect={() => showChat(project.id)}>
                    <FolderIcon size={15} aria-hidden />
                    <span className="truncate">{project.name}</span>
                  </MenuItem>
                ))}
              </MenuGroup>
            </>
          ) : null}
        </MenuContent>
      </Menu>
      {source ? <NewProjectDialog source={source} onClose={() => setSource(null)} /> : null}
    </>
  )
}

/** The form behind "Open GitHub project" and "Quick start". */
function NewProjectDialog({ source, onClose }: { source: Source; onClose: () => void }) {
  const { t } = useTranslation()
  const projectsFolder = useAppStore((s) => s.projectsFolder)
  const chooseProjectsFolder = useAppStore((s) => s.chooseProjectsFolder)
  const cloneProject = useAppStore((s) => s.cloneProject)
  const createProject = useAppStore((s) => s.createProject)
  const titleId = useId()
  const [value, setValue] = useState('')
  const [parent, setParent] = useState<string | null>(null)
  const [defaultParent, setDefaultParent] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  useEffect(() => {
    let live = true
    void projectsFolder().then((folder) => {
      if (live) setDefaultParent(folder)
    })
    return () => {
      live = false
    }
  }, [projectsFolder])

  const repo = source === 'github' ? parseGitHubRepo(value) : null
  const name = source === 'github' ? (repo?.repo ?? null) : value.trim() || null
  const valid = source === 'github' ? repo !== null : projectNameSchema.safeParse(value).success
  const invalid = value.trim() !== '' && !valid
  const folder = parent ?? defaultParent
  const close = () => {
    if (!busy) onClose()
  }
  async function submit() {
    if (!valid || busy) return
    setBusy(true)
    setFailure(null)
    const result =
      source === 'github'
        ? await cloneProject({ url: value, parent })
        : await createProject({ name: value.trim(), parent })
    setBusy(false)
    if (result) setFailure(result)
    else onClose()
  }
  async function chooseFolder() {
    const chosen = await chooseProjectsFolder()
    if (chosen) setParent(chosen)
  }
  return (
    <Dialog className="router-new-project" aria-labelledby={titleId} onClose={close}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <h2 id={titleId}>{t(`project.${source}.title`)}</h2>
        <p>{t(`project.${source}.body`)}</p>
        <input
          className="router-input"
          autoFocus
          spellCheck={false}
          autoComplete="off"
          aria-label={t(`project.${source}.label`)}
          aria-invalid={invalid || undefined}
          placeholder={t(`project.${source}.placeholder`)}
          value={value}
          disabled={busy}
          onChange={(event) => {
            setValue(event.target.value)
            setFailure(null)
          }}
        />
        {invalid ? (
          <p className="router-new-project-error">{t(`project.${source}.invalid`)}</p>
        ) : null}
        <div className="router-new-project-location">
          <span>{t('project.location')}</span>
          <code>{folder && name ? `${folder}/${name}` : (folder ?? '')}</code>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void chooseFolder()}
          >
            {t('project.changeLocation')}
          </Button>
        </div>
        {failure ? (
          <p className="router-new-project-error" role="alert">
            {failureMessage(failure)}
          </p>
        ) : null}
        <footer>
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={close}>
            {t('forward.cancel')}
          </Button>
          <Button type="submit" size="sm" disabled={!valid || busy}>
            {busy ? <LoaderIcon size={13} className="animate-spin" aria-hidden /> : null}
            {t(busy ? `project.${source}.busy` : `project.${source}.submit`)}
          </Button>
        </footer>
      </form>
    </Dialog>
  )
}
