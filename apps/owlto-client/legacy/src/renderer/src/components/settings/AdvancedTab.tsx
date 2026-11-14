import { type I18nKey, useI18n } from '@renderer/lib/i18n'
import { useFeatureGateStore } from '@renderer/stores/feature-gate-store'
import { useSessionStore } from '@renderer/stores/session-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { FileSearch, Loader2, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SettingsButton, SettingsCard, SettingsRow, SettingsTextInput } from './settings-ui'
import { ToggleButton } from './ToggleButton'

export function AdvancedTab(): React.JSX.Element {
  const { t } = useI18n()
  const {
    debugMode,
    modelTrajectoryLoggingEnabled,
    devInstance,
    devInstanceBadgeVisible,
    toggleDebugMode,
    updateModelTrajectoryLoggingEnabled,
    updateDevInstanceBadgeVisible
  } = useSettingsStore()
  const importSessionJsonl = useSessionStore((state) => state.importSessionJsonl)
  const navigate = useNavigate()
  const {
    gates,
    load: loadFeatureGates,
    setEnabled: setFeatureGateEnabled,
    busyKey
  } = useFeatureGateStore()
  const [clearingPlugins, setClearingPlugins] = useState(false)
  const [clearPluginsMessage, setClearPluginsMessage] = useState<string | null>(null)
  const [sessionImportValue, setSessionImportValue] = useState('')
  const [importingSession, setImportingSession] = useState(false)
  const [sessionImportMessage, setSessionImportMessage] = useState<string | null>(null)

  useEffect(() => {
    void loadFeatureGates()
  }, [loadFeatureGates])

  const importSharedSession = async (): Promise<void> => {
    const value = sessionImportValue.trim()
    if (!value || importingSession) return

    setImportingSession(true)
    setSessionImportMessage(null)
    try {
      const sessionId = await importSessionJsonl(value)
      if (!sessionId) {
        setSessionImportMessage(t('advanced.importSession.failed'))
        return
      }
      setSessionImportValue('')
      setSessionImportMessage(t('advanced.importSession.success'))
      navigate('/')
    } catch (error) {
      setSessionImportMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setImportingSession(false)
    }
  }

  const clearInstalledPlugins = async (): Promise<void> => {
    if (!window.confirm(t('advanced.clearPlugins.confirm'))) return

    setClearingPlugins(true)
    setClearPluginsMessage(null)
    try {
      const result = await window.api.plugins.clearInstalled()
      setClearPluginsMessage(
        t('advanced.clearPlugins.success', {
          count: result.removedCount
        })
      )
    } catch (error) {
      setClearPluginsMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setClearingPlugins(false)
    }
  }

  return (
    <SettingsCard>
      <SettingsRow
        label={t('advanced.debugMode.label')}
        description={t('advanced.debugMode.description')}
      >
        <ToggleButton checked={debugMode} onClick={() => void toggleDebugMode()} />
      </SettingsRow>

      <SettingsRow
        label={t('advanced.modelTrajectory.enable.label')}
        description={t('advanced.modelTrajectory.enable.description')}
      >
        <ToggleButton
          checked={modelTrajectoryLoggingEnabled}
          onClick={() => void updateModelTrajectoryLoggingEnabled(!modelTrajectoryLoggingEnabled)}
        />
      </SettingsRow>

      <SettingsRow
        label={t('advanced.sessionInspector.open.label')}
        description={t('advanced.sessionInspector.open.description')}
      >
        <SettingsButton
          onClick={() => {
            void window.api.sessionInspector.openWindow()
          }}
        >
          <FileSearch className="size-3.5" strokeWidth={1.8} />
          {t('advanced.sessionInspector.open.button')}
        </SettingsButton>
      </SettingsRow>

      {devInstance ? (
        <SettingsRow
          label={t('advanced.devInstanceBadge.label')}
          description={t('advanced.devInstanceBadge.description')}
        >
          <ToggleButton
            checked={devInstanceBadgeVisible}
            onClick={() => void updateDevInstanceBadgeVisible(!devInstanceBadgeVisible)}
          />
        </SettingsRow>
      ) : null}

      <div className="border-b border-border/55 px-3.5 py-4">
        <div className="mb-3">
          <h3 className="text-[13px] font-medium leading-5 text-foreground">
            {t('advanced.section.featureGates')}
          </h3>
          <p className="mt-0.5 text-[12.5px] leading-[1.35] text-muted-foreground">
            {t('advanced.featureGates.description')}
          </p>
        </div>
        <div className="flex flex-col gap-3">
          {gates.map((gate) => (
            <div
              key={gate.key}
              className="flex min-h-[52px] items-center justify-between gap-6 rounded-lg bg-foreground/3 px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <h4 className="text-[13px] font-medium leading-5 text-foreground">
                  {t(gate.labelKey as I18nKey)}
                </h4>
                <p className="mt-0.5 text-[12.5px] leading-[1.35] text-muted-foreground">
                  {t(gate.descriptionKey as I18nKey)}
                </p>
              </div>
              <ToggleButton
                checked={gate.enabled}
                disabled={busyKey === gate.key}
                onClick={() => void setFeatureGateEnabled(gate.key, !gate.enabled)}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="border-b border-border/55 px-3.5 py-4">
        <div className="mb-3">
          <h3 className="text-[13px] font-medium leading-5 text-foreground">
            {t('advanced.importSession.label')}
          </h3>
          <p className="mt-0.5 text-[12.5px] leading-[1.35] text-muted-foreground">
            {t('advanced.importSession.description')}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2">
            <SettingsTextInput
              value={sessionImportValue}
              onChange={(event) => {
                setSessionImportValue(event.target.value)
                setSessionImportMessage(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void importSharedSession()
                }
              }}
              disabled={importingSession}
              placeholder={t('advanced.importSession.placeholder')}
              className="min-w-0 flex-1"
            />
            <SettingsButton
              disabled={!sessionImportValue.trim() || importingSession}
              onClick={() => void importSharedSession()}
            >
              {importingSession ? (
                <Loader2 className="size-3.5 animate-spin" strokeWidth={1.8} />
              ) : null}
              {importingSession
                ? t('advanced.importSession.loading')
                : t('advanced.importSession.button')}
            </SettingsButton>
          </div>
          {sessionImportMessage ? (
            <p className="text-[12px] leading-4 text-muted-foreground">{sessionImportMessage}</p>
          ) : null}
        </div>
      </div>

      <SettingsRow
        label={t('advanced.clearPlugins.label')}
        description={t('advanced.clearPlugins.description')}
      >
        <div className="flex flex-col items-end gap-1.5">
          <SettingsButton
            variant="danger"
            disabled={clearingPlugins}
            onClick={() => void clearInstalledPlugins()}
          >
            {clearingPlugins ? (
              <Loader2 className="size-3.5 animate-spin" strokeWidth={1.8} />
            ) : (
              <Trash2 className="size-3.5" strokeWidth={1.8} />
            )}
            {t('advanced.clearPlugins.button')}
          </SettingsButton>
          {clearPluginsMessage ? (
            <p className="max-w-[320px] text-right text-[12px] leading-4 text-muted-foreground">
              {clearPluginsMessage}
            </p>
          ) : null}
        </div>
      </SettingsRow>
    </SettingsCard>
  )
}
