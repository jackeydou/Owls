import { ActionButton } from '@renderer/components/ui/action-button'
import { FolderIcon, GitBranchIcon } from '@renderer/components/ui/icons'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { WorkspaceFolder } from '../../../shared/workspace'
import { projectHue } from '../router/activity'
import { ProjectIcon } from '../router/ProjectIcon'
import { SettingRow } from './SettingRow'
import { WorkspaceFolderRow } from './SettingsRouterWorkers'
import { useAppStore } from './store'
import { useWorkspaceStore } from './workspace'

function FolderRow({ folder }: { folder: WorkspaceFolder }) {
  const { t } = useTranslation()
  const project = useAppStore((s) => s.projects.find((p) => p.id === folder.projectId))
  const showProjectSettings = useAppStore((s) => s.showProjectSettings)
  const promote = useWorkspaceStore((s) => s.promote)
  const mergeBack = useWorkspaceStore((s) => s.mergeBack)
  return (
    <li className="owlto-workspace-folder">
      {project ? (
        <button
          type="button"
          className="owlto-workspace-folder-name"
          style={
            { '--owl-c': projectHue(project.id, project.settings.color) } as React.CSSProperties
          }
          aria-label={t('workspace.openSettings', { project: project.name })}
          onClick={() => showProjectSettings(project.id)}
        >
          <ProjectIcon project={project} />
          <span>{folder.name}</span>
        </button>
      ) : (
        <span className="owlto-workspace-folder-name">
          <FolderIcon size={15} aria-hidden />
          <span>{folder.name}</span>
        </span>
      )}
      <span className="owlto-workspace-folder-tags">
        {folder.git ? (
          <em>
            <GitBranchIcon size={12} aria-hidden />
            {t('workspace.git')}
          </em>
        ) : null}
        {project ? <em className="project">{t('workspace.isProject')}</em> : null}
      </span>
      {project ? (
        <ActionButton
          size="sm"
          variant="ghost"
          doneLabel={t('workspace.merged')}
          onAction={async () => ((await mergeBack(project.id)) ? 'done' : 'quiet')}
        >
          {t('workspace.mergeBack')}
        </ActionButton>
      ) : (
        <ActionButton
          size="sm"
          variant="outline"
          doneLabel={t('workspace.promoted')}
          onAction={async () => ((await promote(folder.path)) ? 'done' : 'quiet')}
        >
          {t('workspace.promote')}
        </ActionButton>
      )}
    </li>
  )
}

/** The Workspace: where project-less tasks run, and which of its folders are projects. */
export function WorkspaceSettingsPane() {
  const { t } = useTranslation()
  const listing = useWorkspaceStore((s) => s.listing)
  const refresh = useWorkspaceStore((s) => s.refresh)
  const custom = useAppStore((s) => s.settings.workspacePath)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `custom` is the trigger, not an input.
  useEffect(() => {
    void refresh()
  }, [refresh, custom])
  const folders = listing?.folders
  return (
    <section className="owlto-settings-section">
      <h2>{t('workspace.page.title')}</h2>
      <p>{t('workspace.page.body')}</p>
      <WorkspaceFolderRow />
      <SettingRow
        label={t('workspace.folders')}
        description={t('workspace.foldersBody')}
        detail={
          !folders ? (
            <p className="owlto-workspace-empty">{t('workspace.foldersLoading')}</p>
          ) : folders.length ? (
            <ul className="owlto-workspace-folders" aria-label={t('workspace.folders')}>
              {folders.map((folder) => (
                <FolderRow key={folder.path} folder={folder} />
              ))}
            </ul>
          ) : (
            <p className="owlto-workspace-empty">{t('workspace.foldersEmpty')}</p>
          )
        }
      />
    </section>
  )
}
