import { Button } from '@renderer/components/ui/button'
import { ChevronDownIcon, ChevronRightIcon } from '@renderer/components/ui/icons'
import { Select } from '@renderer/components/ui/select'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Project } from '../../../shared/app'
import {
  DEFAULT_REMOTE,
  PROJECT_INSTRUCTIONS_LIMIT,
  type ProjectGitRefs,
  type ProjectInstructions,
  type ProjectSettings
} from '../../../shared/projects'
import { SettingRow } from './SettingRow'
import { useAppStore } from './store'

/** Saves a change to one project, merging it into the project as it is now. */
function useProjectSaver(project: Project) {
  const saveProject = useAppStore((s) => s.saveProject)
  return (change: { name?: string; settings?: Partial<ProjectSettings> }) =>
    saveProject({
      id: project.id,
      name: change.name ?? project.name,
      settings: { ...project.settings, ...change.settings }
    })
}

/**
 * A text field that saves when it loses focus, so typing never writes on every key.
 * An `input` with `single`, otherwise a textarea.
 */
function DraftText({
  id,
  value,
  onCommit,
  single = false,
  required = false,
  maxLength,
  placeholder,
  className,
  ...aria
}: {
  id?: string
  value: string
  onCommit: (value: string) => void
  single?: boolean
  required?: boolean
  maxLength: number
  placeholder?: string
  className?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
}) {
  const [draft, setDraft] = useState(value)
  // A save elsewhere, or another project, replaces what is shown.
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    const next = single ? draft.trim() : draft
    if (required && !next) {
      setDraft(value)
      return
    }
    if (next !== value) onCommit(next)
  }
  const shared = {
    id,
    value: draft,
    maxLength,
    placeholder,
    className,
    onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
    onBlur: commit,
    ...aria
  }
  return single ? (
    <input
      {...shared}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') setDraft(value)
      }}
    />
  ) : (
    <textarea {...shared} rows={5} />
  )
}

function GeneralPage({ project }: { project: Project }) {
  const { t } = useTranslation()
  const save = useProjectSaver(project)
  const descriptionLabel = useId()
  return (
    <section className="owls-settings-section">
      <h2>{t('projectSettings.page.general')}</h2>
      <SettingRow
        label={t('projectSettings.name')}
        htmlFor="project-name"
        description={t('projectSettings.nameHelp')}
      >
        <DraftText
          id="project-name"
          single
          required
          className="router-input"
          maxLength={100}
          value={project.name}
          onCommit={(name) => void save({ name })}
        />
      </SettingRow>
      <SettingRow
        label={t('projectSettings.location')}
        description={t('projectSettings.locationHelp')}
        detail={<code className="owls-path">{project.path}</code>}
      />
      <SettingRow
        label={t('projectSettings.description')}
        labelId={descriptionLabel}
        description={t('projectSettings.descriptionHelp')}
        detail={
          <DraftText
            className="owls-setting-textarea"
            aria-labelledby={descriptionLabel}
            maxLength={500}
            placeholder={t('projectSettings.descriptionPlaceholder')}
            value={project.settings.description}
            onCommit={(description) => void save({ settings: { description } })}
          />
        }
      />
    </section>
  )
}

/** Options with the saved value kept even when the repository no longer has it. */
const withSaved = (list: string[], saved: string | null) =>
  saved && !list.includes(saved) ? [saved, ...list] : list

function GitPage({ project }: { project: Project }) {
  const { t } = useTranslation()
  const save = useProjectSaver(project)
  const projectGitRefs = useAppStore((s) => s.projectGitRefs)
  const worktrees = useAppStore((s) => s.settings.router.worktrees)
  const showSettings = useAppStore((s) => s.showSettings)
  const [refs, setRefs] = useState<ProjectGitRefs | null | 'loading'>('loading')
  useEffect(() => {
    let live = true
    setRefs('loading')
    void projectGitRefs(project.id).then((value) => {
      if (live) setRefs(value)
    })
    return () => {
      live = false
    }
  }, [project.id, projectGitRefs])
  const git = project.settings.git
  const saveGit = (change: Partial<ProjectSettings['git']>) =>
    void save({ settings: { git: { ...git, ...change } } })
  const remoteBranches = refs && refs !== 'loading' ? refs.remoteBranches : []
  const localBranches = refs && refs !== 'loading' ? refs.branches : []
  const local =
    git.baseBranch && !remoteBranches.includes(git.baseBranch)
      ? withSaved(localBranches, git.baseBranch)
      : localBranches
  const remotes = withSaved(refs && refs !== 'loading' ? refs.remotes : [], git.remote)
  return (
    <section className="owls-settings-section">
      <h2>{t('projectSettings.page.git')}</h2>
      <p>{t('projectSettings.gitBody')}</p>
      {worktrees ? null : (
        <p className="owls-note">
          {t('projectSettings.worktreesOff')}
          <Button
            size="custom"
            variant="link"
            className="owls-inline-link"
            onClick={() => showSettings('router')}
          >
            {t('projectSettings.openRouterSettings')}
          </Button>
        </p>
      )}
      {refs === 'loading' ? (
        <p className="owls-note">{t('projectSettings.loadingRefs')}</p>
      ) : refs === null ? (
        <p className="owls-note">{t('projectSettings.notGit')}</p>
      ) : (
        <>
          <SettingRow
            label={t('projectSettings.baseBranch')}
            htmlFor="project-base-branch"
            description={t('projectSettings.baseBranchHelp')}
          >
            <Select
              id="project-base-branch"
              value={git.baseBranch ?? ''}
              onChange={(event) => saveGit({ baseBranch: event.target.value || null })}
            >
              <option value="">{t('projectSettings.baseBranch.head')}</option>
              {remoteBranches.length ? (
                <optgroup label={t('projectSettings.remoteBranches')}>
                  {remoteBranches.map((ref) => (
                    <option value={ref} key={ref}>
                      {ref}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {local.length ? (
                <optgroup label={t('projectSettings.localBranches')}>
                  {local.map((ref) => (
                    <option value={ref} key={ref}>
                      {ref}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </Select>
          </SettingRow>
          <SettingRow
            label={t('projectSettings.remote')}
            htmlFor="project-remote"
            description={t('projectSettings.remoteHelp')}
          >
            <Select
              id="project-remote"
              value={git.remote ?? DEFAULT_REMOTE}
              onChange={(event) =>
                saveGit({
                  remote: event.target.value === DEFAULT_REMOTE ? null : event.target.value
                })
              }
            >
              {withSaved(remotes, DEFAULT_REMOTE).map((remote) => (
                <option value={remote} key={remote}>
                  {remote}
                </option>
              ))}
            </Select>
          </SettingRow>
          <SettingRow
            label={t('projectSettings.deletePushedBranches')}
            htmlFor="project-delete-pushed"
            description={t('projectSettings.deletePushedBranchesHelp')}
          >
            <Select
              id="project-delete-pushed"
              value={git.deletePushedBranches ? 'on' : 'off'}
              onChange={(event) => saveGit({ deletePushedBranches: event.target.value === 'on' })}
            >
              <option value="on">{t('projectSettings.on')}</option>
              <option value="off">{t('projectSettings.off')}</option>
            </Select>
          </SettingRow>
        </>
      )}
    </section>
  )
}

const INSTRUCTION_KINDS = ['general', 'codeReview', 'pullRequest'] as const satisfies ReadonlyArray<
  keyof ProjectInstructions
>

function InstructionRow({
  project,
  kind
}: {
  project: Project
  kind: (typeof INSTRUCTION_KINDS)[number]
}) {
  const { t } = useTranslation()
  const save = useProjectSaver(project)
  const value = project.settings.instructions[kind]
  const [open, setOpen] = useState(() => kind === 'general' || value.trim() !== '')
  const labelId = useId()
  const fieldId = useId()
  const name = t(`projectSettings.instructions.${kind}`)
  const toggle = t(open ? 'projectSettings.collapse' : 'projectSettings.expand', { name })
  return (
    <SettingRow
      label={name}
      labelId={labelId}
      description={t(`projectSettings.instructions.${kind}Help`)}
      detail={
        open ? (
          <DraftText
            id={fieldId}
            className="owls-setting-textarea code"
            aria-labelledby={labelId}
            maxLength={PROJECT_INSTRUCTIONS_LIMIT}
            placeholder={t('projectSettings.instructionsPlaceholder')}
            value={value}
            onCommit={(text) =>
              void save({
                settings: { instructions: { ...project.settings.instructions, [kind]: text } }
              })
            }
          />
        ) : null
      }
    >
      <Button
        size="custom"
        variant="ghost"
        className="owls-setting-disclosure"
        aria-label={toggle}
        aria-expanded={open}
        aria-controls={open ? fieldId : undefined}
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDownIcon size={15} /> : <ChevronRightIcon size={15} />}
      </Button>
    </SettingRow>
  )
}

function InstructionsPage({ project }: { project: Project }) {
  const { t } = useTranslation()
  return (
    <section className="owls-settings-section">
      <h2>{t('projectSettings.page.instructions')}</h2>
      <p>{t('projectSettings.instructionsBody')}</p>
      {INSTRUCTION_KINDS.map((kind) => (
        <InstructionRow key={kind} project={project} kind={kind} />
      ))}
    </section>
  )
}

const PAGES = { general: GeneralPage, git: GitPage, instructions: InstructionsPage }

/** The page of one project's settings that the Settings navigation selected. */
export function ProjectSettingsPane() {
  const { t } = useTranslation()
  const target = useAppStore((s) => s.settingsProject)
  const project = useAppStore((s) => s.projects.find((p) => p.id === target?.projectId))
  if (!target || !project)
    return (
      <section className="owls-settings-section">
        <p className="owls-note">{t('projectSettings.missing')}</p>
      </section>
    )
  const Page = PAGES[target.page]
  return <Page project={project} />
}
