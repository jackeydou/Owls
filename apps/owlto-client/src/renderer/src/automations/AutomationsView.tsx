import { ActionButton } from '@renderer/components/ui/action-button'
import { Button } from '@renderer/components/ui/button'
import { IconButton } from '@renderer/components/ui/icon-button'
import {
  AutomationIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  GitPullRequestIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon
} from '@renderer/components/ui/icons'
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger
} from '@renderer/components/ui/menu'
import { Switch } from '@renderer/components/ui/switch'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Automation } from '../../../shared/automations'
import { useAppStore } from '../app/store'
import { workerTitle } from '../router/activity'
import { useRouterStore } from '../router/store'
import { AutomationDialog } from './AutomationDialog'
import { useScheduleText, useWhen } from './schedule-text'
import { useAutomationsStore, watchAutomations } from './store'
import './automations.css'

/** Where an automation's runs go, as a short label. */
function TargetLabel({ automation }: { automation: Automation }) {
  const { t } = useTranslation()
  const target = automation.target
  const worker = useRouterStore((s) =>
    target.kind === 'worker' ? s.workers.find((w) => w.id === target.workerId) : undefined
  )
  const thread = useRouterStore((s) =>
    target.threadId ? s.routers.find((r) => r.id === target.threadId) : undefined
  )
  const project = useAppStore((s) => s.projects.find((p) => p.id === automation.projectId))
  if (target.kind === 'worker')
    return (
      <span className="automations-target">
        {t('automations.target.worker')}
        {worker ? ` · ${workerTitle(worker)}` : ''}
      </span>
    )
  if (!target.threadId || !thread)
    return (
      <span className="automations-target">
        {t('automations.target.newThread')}
        {` · ${project?.name ?? t('automations.workspace')}`}
      </span>
    )
  return (
    <span className="automations-target">
      {t('automations.target.router')}
      {thread.title ? ` · ${thread.title}` : ''}
    </span>
  )
}

function RowMenu({ automation }: { automation: Automation }) {
  const { t } = useTranslation()
  const { edit, remove } = useAutomationsStore()
  const showThread = useAppStore((s) => s.showThread)
  const routers = useRouterStore((s) => s.routers)
  const [confirm, setConfirm] = useState(false)
  const threadId = automation.target.threadId ?? automation.lastRun?.threadId ?? null
  const thread = threadId ? routers.find((r) => r.id === threadId) : undefined
  return (
    <Menu onOpenChange={(open) => open || setConfirm(false)}>
      <MenuTrigger asChild>
        <IconButton
          size="sm"
          label={t('automations.more')}
          tooltip={t('automations.more')}
          icon={<EllipsisIcon size={16} />}
        />
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem onSelect={() => edit({ kind: 'edit', automation })}>
          <PencilIcon size={14} />
          {t('automations.edit')}
        </MenuItem>
        {thread ? (
          <MenuItem onSelect={() => showThread(thread.id)}>
            <ExternalLinkIcon size={14} />
            {t('automations.openThread')}
          </MenuItem>
        ) : null}
        <MenuSeparator />
        <MenuItem
          className="text-destructive"
          onSelect={(event) => {
            if (confirm) return void remove(automation.id)
            event.preventDefault()
            setConfirm(true)
          }}
        >
          <TrashIcon size={14} />
          {t(confirm ? 'automations.confirmDelete' : 'automations.delete')}
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}

function Row({ automation }: { automation: Automation }) {
  const { t } = useTranslation()
  const scheduleText = useScheduleText()
  const when = useWhen()
  const { edit, setEnabled, runNow } = useAutomationsStore()
  const failed = automation.lastRun?.status === 'failed' ? automation.lastRun : null
  return (
    <li className={automation.enabled ? 'automations-row' : 'automations-row paused'}>
      <span className="automations-glyph" aria-hidden>
        <AutomationIcon size={18} />
      </span>
      <button
        type="button"
        className="automations-main"
        onClick={() => edit({ kind: 'edit', automation })}
      >
        <strong>{automation.name}</strong>
        <span className="automations-meta">
          <span>{scheduleText(automation.schedule)}</span>
          <TargetLabel automation={automation} />
          <span>{t(`automations.by.${automation.createdBy}`)}</span>
        </span>
        <span className="automations-instructions">{automation.instructions}</span>
      </button>
      <div className="automations-side">
        <span className={failed ? 'automations-when bad' : 'automations-when'}>
          {failed
            ? t('automations.lastFailed', { time: when(failed.at) })
            : automation.nextRunAt
              ? t('automations.nextRun', { time: when(automation.nextRunAt) })
              : t('automations.paused')}
        </span>
        <ActionButton
          size="sm"
          variant="ghost"
          onAction={async () => {
            await runNow(automation.id)
            return 'done'
          }}
        >
          {t('automations.runNow')}
        </ActionButton>
        <Switch
          checked={automation.enabled}
          aria-label={t('automations.enable', { name: automation.name })}
          onCheckedChange={(enabled) => void setEnabled(automation.id, enabled)}
        />
        <RowMenu automation={automation} />
      </div>
    </li>
  )
}

/** The event trigger: GitHub changes on agent pull requests go to the worker that opened them. */
function FollowUpsRow() {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const saveSettings = useAppStore((s) => s.saveSettings)
  const signedIn = useAppStore((s) => s.github.status === 'signed-in')
  const on = settings.pullRequestFollowUps
  return (
    <ul className="automations-list">
      <li className={`automations-row${on && signedIn ? '' : ' paused'}`}>
        <span className="automations-glyph" aria-hidden>
          <GitPullRequestIcon size={16} />
        </span>
        <div className="automations-main static">
          <strong>{t('automations.followUps.title')}</strong>
          <span className="automations-body-text">{t('automations.followUps.body')}</span>
          {signedIn ? null : (
            <span className="automations-meta">{t('automations.followUps.signedOut')}</span>
          )}
        </div>
        <div className="automations-side">
          <Switch
            checked={on}
            aria-label={t('automations.followUps.toggle')}
            onCheckedChange={(value) =>
              void saveSettings({ ...settings, pullRequestFollowUps: value })
            }
          />
        </div>
      </li>
    </ul>
  )
}

export function AutomationsView() {
  const { t } = useTranslation()
  const { automations, failed, editing, edit } = useAutomationsStore()
  useEffect(() => watchAutomations(), [])
  return (
    <main className="owlto-chat automations-view">
      <header className="owlto-topbar router-topbar">
        <div className="router-thread-heading">
          <strong>{t('automations.title')}</strong>
          <span>{t('automations.subtitle')}</span>
        </div>
        <div className="owlto-topbar-actions">
          <IconButton
            size="sm"
            label={t('automations.new')}
            tooltip={t('automations.new')}
            tooltipSide="bottom"
            icon={<PlusIcon size={16} />}
            onClick={() => edit({ kind: 'new' })}
          />
        </div>
      </header>
      <div className="automations-body">
        <h2 className="automations-heading">{t('automations.events')}</h2>
        <FollowUpsRow />
        <h2 className="automations-heading">{t('automations.scheduled')}</h2>
        {failed ? <p className="automations-note bad">{t('automations.failed')}</p> : null}
        {!automations ? (
          failed ? null : (
            <p className="automations-note">{t('automations.loading')}</p>
          )
        ) : automations.length ? (
          <>
            <ul className="automations-list" aria-label={t('automations.list')}>
              {automations.map((automation) => (
                <Row key={automation.id} automation={automation} />
              ))}
            </ul>
            <p className="automations-note">{t('automations.openNote')}</p>
          </>
        ) : (
          <div className="automations-empty">
            <AutomationIcon size={28} aria-hidden />
            <p>{t('automations.empty')}</p>
            <Button size="sm" onClick={() => edit({ kind: 'new' })}>
              <PlusIcon size={15} />
              {t('automations.new')}
            </Button>
            <p className="automations-note">{t('automations.openNote')}</p>
          </div>
        )}
      </div>
      {editing ? <AutomationDialog editing={editing} onClose={() => edit(null)} /> : null}
    </main>
  )
}
