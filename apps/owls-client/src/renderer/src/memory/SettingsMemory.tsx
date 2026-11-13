import { ActionButton } from '@renderer/components/ui/action-button'
import { Button } from '@renderer/components/ui/button'
import { DownloadIcon, LoaderIcon, SparklesIcon, XIcon } from '@renderer/components/ui/icons'
import { Select } from '@renderer/components/ui/select'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { MemoryRun, MemorySettings } from '../../../shared/memory'
import { memoryProviderSchema } from '../../../shared/memory'
import { SettingRow } from '../app/SettingRow'
import { useAppStore } from '../app/store'
import { useRouterStore } from '../router/store'
import { MemoryBrowser } from './MemoryBrowser'
import { useMemoryStore } from './store'
import './memory.css'

const clock = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })

/** A failed run's reason in the user's words. */
export function runReason(run: MemoryRun, t: (key: string) => string): string {
  const code = run.error?.code
  return code === 'claude_not_connected' || code === 'not_connected' || code === 'interrupted'
    ? t(`memory.reason.${code}`)
    : t('memory.reason.other')
}

function OnOff({
  id,
  value,
  onChange
}: {
  id: string
  value: boolean
  onChange: (value: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <Select
      id={id}
      value={value ? 'on' : 'off'}
      onChange={(event) => onChange(event.target.value === 'on')}
    >
      <option value="on">{t('memory.on')}</option>
      <option value="off">{t('memory.off')}</option>
    </Select>
  )
}

function MemorySettingsRows() {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const saveSettings = useAppStore((s) => s.saveSettings)
  const claude = useAppStore((s) => s.claude)
  const codex = useAppStore((s) => s.connection)
  const memory = settings.memory
  const save = (next: Partial<MemorySettings>) =>
    void saveSettings({ ...settings, memory: { ...memory, ...next } })
  const provider = memory.provider ?? settings.provider
  const connection = provider === 'claude-code' ? claude : codex
  return (
    <>
      <SettingRow
        label={t('memory.learn')}
        htmlFor="memory-learn"
        description={t('memory.learnHelp')}
      >
        <OnOff id="memory-learn" value={memory.learn} onChange={(learn) => save({ learn })} />
      </SettingRow>
      <SettingRow
        label={t('memory.inject')}
        htmlFor="memory-inject"
        description={t('memory.injectHelp')}
      >
        <OnOff id="memory-inject" value={memory.inject} onChange={(inject) => save({ inject })} />
      </SettingRow>
      <SettingRow label={t('memory.provider')} htmlFor="memory-provider">
        <Select
          id="memory-provider"
          value={memory.provider ?? ''}
          onChange={(event) =>
            save({
              provider: event.target.value ? memoryProviderSchema.parse(event.target.value) : null
            })
          }
        >
          <option value="">
            {t('memory.provider.default', { agent: t(`agent.${settings.provider}`) })}
          </option>
          {memoryProviderSchema.options.map((option) => (
            <option value={option} key={option}>
              {t(`agent.${option}`)}
            </option>
          ))}
        </Select>
      </SettingRow>
      <SettingRow
        label={t('memory.model')}
        htmlFor="memory-model"
        description={
          connection.status === 'ready'
            ? null
            : t(
                provider === 'claude-code'
                  ? 'memory.claudeDisconnected'
                  : 'memory.codexDisconnected'
              )
        }
      >
        <Select
          id="memory-model"
          value={(provider === 'claude-code' ? memory.claudeModel : memory.codexModel) ?? ''}
          onChange={(event) => {
            const model = event.target.value || null
            save(provider === 'claude-code' ? { claudeModel: model } : { codexModel: model })
          }}
        >
          <option value="">{t('memory.model.default')}</option>
          {connection.models
            .filter((m) => provider !== 'claude-code' || !m.isDefault)
            .map((m) => (
              <option value={m.id} key={m.id}>
                {m.name}
              </option>
            ))}
        </Select>
      </SettingRow>
      <p className="owls-note">{t('memory.deviceNote')}</p>
    </>
  )
}

function RunStatus() {
  const { t } = useTranslation()
  const learn = useAppStore((s) => s.settings.memory.learn)
  const overview = useMemoryStore((s) => s.overview)
  const runNow = useMemoryStore((s) => s.runNow)
  const exportAs = useMemoryStore((s) => s.exportAs)
  const last = overview?.lastRun ?? null
  const running = overview?.running ?? false
  const status = running
    ? t('memory.running')
    : !last
      ? t('memory.neverRun')
      : last.status === 'failed'
        ? t('memory.lastRunFailed', { reason: runReason(last, t) })
        : t('memory.lastRun', { time: clock(last.createdAt), count: last.added.length })
  return (
    <div className="memory-status">
      <span role="status" className={last?.status === 'failed' && !running ? 'failed' : undefined}>
        {running ? <LoaderIcon size={14} className="animate-spin" aria-hidden /> : null}
        {status}
      </span>
      <div className="owls-settings-actions">
        <ActionButton
          size="sm"
          variant="outline"
          disabled={!learn}
          pending={running}
          icon={<SparklesIcon size={15} aria-hidden />}
          onAction={runNow}
        >
          {t('memory.runNow')}
        </ActionButton>
        <ActionButton
          size="sm"
          variant="outline"
          icon={<DownloadIcon size={15} aria-hidden />}
          doneLabel={t('memory.export.done')}
          onAction={async () => ((await exportAs('markdown')) ? 'done' : 'quiet')}
        >
          {t('memory.export.markdown')}
        </ActionButton>
        <ActionButton
          size="sm"
          variant="ghost"
          doneLabel={t('memory.export.done')}
          onAction={async () => ((await exportAs('json')) ? 'done' : 'quiet')}
        >
          {t('memory.export.json')}
        </ActionButton>
      </div>
    </div>
  )
}

function RecentRuns() {
  const { t } = useTranslation()
  const runs = useMemoryStore((s) => s.runs)
  const routers = useRouterStore((s) => s.routers)
  const untitled = t('thread.untitled')
  return (
    <details className="memory-runs">
      <summary>{t('memory.runs')}</summary>
      {runs.length ? (
        <ul>
          {runs.map((run) => {
            const values = {
              time: clock(run.createdAt),
              title: routers.find((r) => r.id === run.threadId)?.title ?? untitled,
              added: run.added.length,
              updated: run.updated.length,
              archived: run.archived.length,
              reason: runReason(run, t)
            }
            const notes = [
              run.reviewed.length ? t('memory.run.reviewed', { count: run.reviewed.length }) : null,
              run.merged.length ? t('memory.run.merged', { count: run.merged.length }) : null,
              run.tokens ? t('memory.run.tokens', { count: run.tokens }) : null
            ].filter((note) => note !== null)
            return (
              <li key={run.id}>
                <span>{t(`memory.run.${run.status}`, values)}</span>
                {notes.length ? <small>{notes.join(' · ')}</small> : null}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="owls-note">{t('memory.noRuns')}</p>
      )}
    </details>
  )
}

export function SettingsMemoryPane() {
  const { t } = useTranslation()
  const refresh = useMemoryStore((s) => s.refresh)
  const error = useMemoryStore((s) => s.error)
  const clearError = useMemoryStore((s) => s.clearError)
  useEffect(() => {
    void refresh()
    return window.owls.memory.onChanged(() => void refresh())
  }, [refresh])
  return (
    <section className="owls-settings-section memory-pane">
      <h2>{t('memory.title')}</h2>
      <p>{t('memory.body')}</p>
      <MemorySettingsRows />
      <RunStatus />
      {error ? (
        <div className="owls-inline-error memory-error" role="alert">
          <span>{t(error)}</span>
          <Button
            size="custom"
            variant="ghost"
            aria-label={t('memory.error.dismiss')}
            onClick={clearError}
          >
            <XIcon size={15} aria-hidden />
          </Button>
        </div>
      ) : null}
      <MemoryBrowser />
      <RecentRuns />
    </section>
  )
}
