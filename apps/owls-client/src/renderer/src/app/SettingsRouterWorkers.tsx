import { ActionButton } from '@renderer/components/ui/action-button'
import { FolderOpenIcon } from '@renderer/components/ui/icons'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RouterEngineRows, WorkerLimitRows } from '../router/RouterSettings'
import { TaskOptions } from './Controls'
import { SettingRow } from './SettingRow'
import { useAppStore } from './store'

/** The Router and the workers it sends out, as two groups on one page. */
export function RouterWorkersSettingsPane() {
  const { t } = useTranslation()
  return (
    <section className="owls-settings-section">
      <h2>{t('routerWorkers.title')}</h2>
      <p>{t('routerWorkers.body')}</p>
      <h3 className="owls-settings-subhead">{t('routerSettings.title')}</h3>
      <RouterEngineRows />
      <h3 className="owls-settings-subhead">{t('routerWorkers.workers')}</h3>
      <p className="owls-settings-subhead-body">{t('defaultsBody')}</p>
      <TaskOptions />
      <WorkerLimitRows />
      <WorkspaceFolderRow />
    </section>
  )
}

/** The folder for tasks outside any project, with the default spelled out until the user picks one. */
function WorkspaceFolderRow() {
  const { t } = useTranslation()
  const custom = useAppStore((s) => s.settings.workspacePath)
  const workspaceFolder = useAppStore((s) => s.workspaceFolder)
  const selectWorkspaceFolder = useAppStore((s) => s.selectWorkspaceFolder)
  const resetWorkspaceFolder = useAppStore((s) => s.resetWorkspaceFolder)
  const [folder, setFolder] = useState<string | null>(null)
  // Reads the folder again whenever the saved choice changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `custom` is the trigger, not an input.
  useEffect(() => {
    let live = true
    void workspaceFolder().then((path) => {
      if (live) setFolder(path)
    })
    return () => {
      live = false
    }
  }, [custom, workspaceFolder])
  return (
    <SettingRow
      label={t('workspaceFolder')}
      description={t('workspaceFolderBody')}
      detail={folder ? <code className="owls-path">{folder}</code> : null}
    >
      <div className="owls-settings-actions">
        {custom ? (
          <ActionButton size="sm" variant="ghost" onAction={resetWorkspaceFolder}>
            {t('workspaceFolderReset')}
          </ActionButton>
        ) : null}
        <ActionButton
          size="sm"
          variant="outline"
          icon={<FolderOpenIcon size={16} />}
          // The chosen path appears in the row, so the button only needs to show it is working.
          onAction={async () => void (await selectWorkspaceFolder())}
        >
          {t('workspaceFolderChoose')}
        </ActionButton>
      </div>
    </SettingRow>
  )
}
