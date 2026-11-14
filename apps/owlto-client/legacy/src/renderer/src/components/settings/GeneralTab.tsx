import { useI18n } from '@renderer/lib/i18n'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { Download } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AutoUpdateState } from '../../../../shared/auto-update'
import {
  SettingsButton,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSegmentedControl,
  SettingsSelect,
  SettingsSwitch
} from './settings-ui'

export function GeneralTab(): React.JSX.Element {
  const { t } = useI18n()
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [deviceIdLoadFailed, setDeviceIdLoadFailed] = useState(false)
  const [exportingDiagnostics, setExportingDiagnostics] = useState(false)
  const [diagnosticsMessage, setDiagnosticsMessage] = useState<string | null>(null)
  const [autoUpdateState, setAutoUpdateState] = useState<AutoUpdateState | null>(null)
  const {
    language,
    autoUpdateChannel,
    showInMenuBar,
    followUpBehavior,
    completionNotifications,
    approvalNotifications,
    questionNotifications,
    enableAgentsSkills,
    enableClaudeSkills,
    updateLanguage,
    updateAutoUpdateChannel,
    updateShowInMenuBar,
    updateFollowUpBehavior,
    updateCompletionNotifications,
    updateApprovalNotifications,
    updateQuestionNotifications,
    updateEnableAgentsSkills,
    updateEnableClaudeSkills
  } = useSettingsStore()

  useEffect(() => {
    let cancelled = false
    void window.api.app
      .deviceId()
      .then((value) => {
        if (!cancelled) setDeviceId(value)
      })
      .catch(() => {
        if (!cancelled) setDeviceIdLoadFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.api.autoUpdate.getState().then((nextState) => {
      if (!cancelled) setAutoUpdateState(nextState)
    })
    const unsubscribe = window.api.autoUpdate.onStateChange(setAutoUpdateState)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const updateStatusMessage = (): string | null => {
    if (!autoUpdateState) return null
    switch (autoUpdateState.status) {
      case 'checking':
        return t('general.update.status.checking')
      case 'unavailable':
        return t('general.update.status.unavailable')
      case 'not-available':
        return t('general.update.status.notAvailable')
      case 'downloading':
        return t('general.update.status.available', {
          version: autoUpdateState.availableVersion ?? ''
        })
      case 'downloaded':
        return t('general.update.status.ready', {
          version: autoUpdateState.availableVersion ?? ''
        })
      case 'error':
        return t('general.update.status.error', {
          message: autoUpdateState.error ?? t('general.update.status.unknownError')
        })
      default:
        return null
    }
  }

  const handleUpdateAction = async (): Promise<void> => {
    const nextState =
      autoUpdateState?.status === 'downloaded'
        ? await window.api.autoUpdate.install()
        : await window.api.autoUpdate.check()
    setAutoUpdateState(nextState)
  }

  const exportDiagnostics = async (): Promise<void> => {
    setExportingDiagnostics(true)
    setDiagnosticsMessage(null)
    try {
      const result = await window.api.diagnostics.export()
      setDiagnosticsMessage(
        result.exported
          ? t('general.diagnostics.export.success', { path: result.path ?? '' })
          : t('general.diagnostics.export.cancelled')
      )
    } catch (error) {
      setDiagnosticsMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setExportingDiagnostics(false)
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-var(--titlebar-height)-208px)] flex-col">
      <div className="space-y-10">
        <SettingsSection title={t('general.section.general')}>
          <SettingsCard>
            <SettingsRow
              label={t('general.language.label')}
              description={t('general.language.description')}
            >
              <SettingsSelect
                value={language}
                onChange={(value) => void updateLanguage(value)}
                options={[
                  { value: 'auto', label: t('general.language.auto') },
                  { value: 'zh-CN', label: t('general.language.zhCN') },
                  { value: 'en', label: t('general.language.en') }
                ]}
              />
            </SettingsRow>
            <SettingsRow
              label={t('general.menuBar.label')}
              description={t('general.menuBar.description')}
            >
              <SettingsSwitch
                checked={showInMenuBar}
                onClick={() => void updateShowInMenuBar(!showInMenuBar)}
              />
            </SettingsRow>
            <SettingsRow
              label={t('general.followUp.label')}
              description={t('general.followUp.description')}
            >
              <SettingsSegmentedControl
                value={followUpBehavior}
                onChange={(value) => void updateFollowUpBehavior(value)}
                options={[
                  { value: 'queue', label: t('general.followUp.queue') },
                  { value: 'steer', label: t('general.followUp.steer') }
                ]}
              />
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>

        <SettingsSection title={t('general.update.label')}>
          <SettingsCard>
            <SettingsRow
              label={t('general.autoUpdateChannel.label')}
              description={t('general.autoUpdateChannel.description')}
            >
              <SettingsSegmentedControl
                value={autoUpdateChannel}
                onChange={(value) => void updateAutoUpdateChannel(value)}
                options={[
                  { value: 'stable', label: t('general.autoUpdateChannel.stable') },
                  { value: 'beta', label: t('general.autoUpdateChannel.beta') }
                ]}
              />
            </SettingsRow>
            <SettingsRow
              label={t('general.update.label')}
              description={t('general.update.description')}
            >
              <div className="flex flex-col items-end gap-1.5">
                <SettingsButton
                  disabled={
                    autoUpdateState?.status === 'checking' ||
                    autoUpdateState?.status === 'downloading' ||
                    autoUpdateState?.status === 'unavailable'
                  }
                  onClick={() => void handleUpdateAction()}
                >
                  <Download className="size-3.5" strokeWidth={1.8} />
                  {autoUpdateState?.status === 'downloaded'
                    ? t('layout.restartToInstall')
                    : autoUpdateState?.status === 'checking'
                      ? t('general.update.checking')
                      : t('general.update.check')}
                </SettingsButton>
                {updateStatusMessage() ? (
                  <p className="max-w-[420px] break-words text-right text-[12px] text-muted-foreground">
                    {updateStatusMessage()}
                  </p>
                ) : null}
              </div>
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>

        <SettingsSection title={t('general.notifications.section')}>
          <SettingsCard>
            <SettingsRow
              label={t('general.completionNotifications.label')}
              description={t('general.completionNotifications.description')}
            >
              <SettingsSelect
                value={completionNotifications}
                onChange={(value) => void updateCompletionNotifications(value)}
                options={[
                  { value: 'never', label: t('general.completionNotifications.never') },
                  { value: 'unfocused', label: t('general.completionNotifications.unfocused') },
                  { value: 'always', label: t('general.completionNotifications.always') }
                ]}
              />
            </SettingsRow>
            <SettingsRow
              label={t('general.approvalNotifications.label')}
              description={t('general.approvalNotifications.description')}
            >
              <SettingsSwitch
                checked={approvalNotifications}
                onClick={() => void updateApprovalNotifications(!approvalNotifications)}
              />
            </SettingsRow>
            <SettingsRow
              label={t('general.questionNotifications.label')}
              description={t('general.questionNotifications.description')}
            >
              <SettingsSwitch
                checked={questionNotifications}
                onClick={() => void updateQuestionNotifications(!questionNotifications)}
              />
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>

        <SettingsSection title={t('general.skills.section')}>
          <SettingsCard>
            <SettingsRow
              label={t('general.skills.agents.label')}
              description={t('general.skills.agents.description')}
            >
              <SettingsSwitch
                checked={enableAgentsSkills}
                onClick={() => void updateEnableAgentsSkills(!enableAgentsSkills)}
              />
            </SettingsRow>
            <SettingsRow
              label={t('general.skills.claude.label')}
              description={t('general.skills.claude.description')}
            >
              <SettingsSwitch
                checked={enableClaudeSkills}
                onClick={() => void updateEnableClaudeSkills(!enableClaudeSkills)}
              />
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>

        <SettingsSection title={t('general.diagnostics.section')}>
          <SettingsCard>
            <SettingsRow
              label={t('general.diagnostics.export.label')}
              description={t('general.diagnostics.export.description')}
            >
              <div className="flex flex-col items-end gap-1.5">
                <SettingsButton
                  disabled={exportingDiagnostics}
                  onClick={() => void exportDiagnostics()}
                >
                  <Download className="size-3.5" strokeWidth={1.8} />
                  {t('general.diagnostics.export.button')}
                </SettingsButton>
                {diagnosticsMessage ? (
                  <p className="max-w-[420px] break-words text-right text-[12px] text-muted-foreground">
                    {diagnosticsMessage}
                  </p>
                ) : null}
              </div>
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>
      </div>

      <p className="mx-auto mt-auto max-w-full truncate pt-10 text-center text-[11.5px] text-muted-foreground/70">
        {deviceIdLoadFailed
          ? t('general.deviceId.unavailable')
          : (deviceId ?? t('general.deviceId.loading'))}
      </p>
    </div>
  )
}
