import { ActionButton } from '@renderer/components/ui/action-button'
import { FolderOpenIcon } from '@renderer/components/ui/icons'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import routerOwl from '../../../../resources/owl-avatars/router.svg'
import workerOwlto from '../../../../resources/owl-avatars/workers.svg'
import { RouterInstructionsRow } from '../router/RouterInstructions'
import { RouterEngineRows, WorkerLimitRows } from '../router/RouterSettings'
import { TaskOptions } from './Controls'
import { SettingRow } from './SettingRow'
import { SettingsTabs } from './SettingsTabs'
import { useAppStore } from './store'

/** The Router and the workers it sends out, one tab each. */
export function RouterWorkersSettingsPane() {
  const { t } = useTranslation()
  const current = useAppStore((s) => s.settingsRouterTab)
  const showRouterSettings = useAppStore((s) => s.showRouterSettings)
  return (
    <section className="owlto-settings-section">
      <h2>{t('routerWorkers.title')}</h2>
      <p>{t('routerWorkers.body')}</p>
      <SettingsTabs
        label={t('routerWorkers.title')}
        tabs={[
          {
            id: 'router',
            label: t('routerSettings.title'),
            icon: <img className="owlto-settings-tab-owl" src={routerOwl} alt="" />
          },
          {
            id: 'workers',
            label: t('routerWorkers.workers'),
            icon: <img className="owlto-settings-tab-owl" src={workerOwlto} alt="" />
          }
        ]}
        current={current}
        onSelect={showRouterSettings}
      >
        {current === 'router' ? (
          <>
            <RouterEngineRows />
            <RouterInstructionsRow />
          </>
        ) : (
          <>
            <p className="owlto-settings-tab-body">{t('defaultsBody')}</p>
            <TaskOptions />
            <WorkerLimitRows />
            <WorkspaceFolderRow />
          </>
        )}
      </SettingsTabs>
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
      detail={folder ? <code className="owlto-path">{folder}</code> : null}
    >
      <div className="owlto-settings-actions">
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
