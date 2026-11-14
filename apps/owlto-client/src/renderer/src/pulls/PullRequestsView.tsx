import { ActionIconButton } from '@renderer/components/ui/action-button'
import { Button } from '@renderer/components/ui/button'
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleMinusIcon,
  CircleXIcon,
  GitBranchIcon,
  type IconComponent,
  RefreshIcon
} from '@renderer/components/ui/icons'
import { Select } from '@renderer/components/ui/select'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Project } from '../../../shared/app'
import { GITHUB_APP_INSTALL_URL } from '../../../shared/github'
import {
  countPullRequests,
  listPullRequests,
  type PullRequestChecksFilter,
  type PullRequestRow,
  type PullRequestSort,
  pullRequestChecksFilters,
  pullRequestSorts,
  pullRequestStateFilters
} from '../../../shared/pull-request-list'
import { OwlAvatar } from '../app/OwlAvatar'
import { useAppStore } from '../app/store'
import { projectHue, workerTitle } from '../router/activity'
import { ProjectIcon } from '../router/ProjectIcon'
import { useRouterStore } from '../router/store'
import { pullRequestRows, usePullRequestsStore, watchPullRequests } from './store'
import './pulls.css'

const CHECK_ICONS: Record<Exclude<PullRequestChecksFilter, 'all'>, IconComponent> = {
  success: CircleCheckIcon,
  failure: CircleXIcon,
  pending: CircleDashedIcon,
  none: CircleMinusIcon
}

/** Re-renders every minute so relative times stay current. */
function useMinuteClock(): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return now
}
function useRelativeTime(): (iso: string, now: number) => string {
  const { i18n } = useTranslation()
  return useMemo(() => {
    const format = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' })
    return (iso, now) => {
      const minutes = Math.round((Date.parse(iso) - now) / 60_000)
      if (Math.abs(minutes) < 60) return format.format(minutes, 'minute')
      const hours = Math.round(minutes / 60)
      if (Math.abs(hours) < 24) return format.format(hours, 'hour')
      return format.format(Math.round(hours / 24), 'day')
    }
  }, [i18n.language])
}

function Toolbar({ rows, projects }: { rows: PullRequestRow[]; projects: Project[] }) {
  const { t } = useTranslation()
  const { state, checks, projectId, sort, setFilter, setSort } = usePullRequestsStore()
  const filter = { state, checks, projectId }
  const stateCounts = countPullRequests(rows, filter, 'state')
  const checkCounts = countPullRequests(rows, filter, 'checks')
  return (
    <div className="pulls-toolbar">
      <div className="pulls-tabs" role="tablist" aria-label={t('pulls.state')}>
        {pullRequestStateFilters.map((value) => (
          <Button
            key={value}
            size="sm"
            variant="ghost"
            role="tab"
            aria-selected={state === value}
            onClick={() => setFilter({ state: value })}
          >
            {t(`pulls.state.${value}`)}
            <small>{stateCounts[value]}</small>
          </Button>
        ))}
      </div>
      <div className="pulls-selects">
        <Select
          aria-label={t('pulls.checks')}
          value={checks}
          onChange={(event) => setFilter({ checks: event.target.value as PullRequestChecksFilter })}
        >
          {pullRequestChecksFilters.map((value) => (
            <option key={value} value={value}>
              {t(`pulls.checks.${value}`)} ({checkCounts[value]})
            </option>
          ))}
        </Select>
        {projects.length > 1 ? (
          <Select
            aria-label={t('pulls.project')}
            value={projectId ?? ''}
            onChange={(event) => setFilter({ projectId: event.target.value || null })}
          >
            <option value="">{t('pulls.project.all')}</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
        ) : null}
        <Select
          aria-label={t('pulls.sort')}
          value={sort}
          onChange={(event) => setSort(event.target.value as PullRequestSort)}
        >
          {pullRequestSorts.map((value) => (
            <option key={value} value={value}>
              {t(`pulls.sort.${value}`)}
            </option>
          ))}
        </Select>
      </div>
    </div>
  )
}

function Row({ row, project, now }: { row: PullRequestRow; project?: Project; now: number }) {
  const { t } = useTranslation()
  const relative = useRelativeTime()
  const worker = useRouterStore((s) => s.workers.find((w) => w.id === row.workerId))
  const showPanel = useRouterStore((s) => s.showPanel)
  const checks = row.checksState ?? 'none'
  const CheckGlyph = CHECK_ICONS[checks]
  const failing = row.checks.filter((check) => check.state === 'failure')
  return (
    <li
      className="pulls-row"
      style={
        { '--owl-c': projectHue(row.projectId, project?.settings.color) } as React.CSSProperties
      }
    >
      <CheckGlyph
        size={16}
        className={`pulls-check ${checks}`}
        aria-label={t(`pulls.checksState.${checks}`)}
        role="img"
      />
      <div className="pulls-main">
        <a className="pulls-title" href={row.url} target="_blank" rel="noreferrer">
          {row.title}
        </a>
        <div className="pulls-meta">
          {project ? (
            <span className="pulls-project">
              <ProjectIcon project={project} />
              {project.name}
            </span>
          ) : null}
          <span>
            {row.owner}/{row.name}#{row.number}
          </span>
          <span className="pulls-branch">
            <GitBranchIcon size={12} aria-hidden />
            {row.branch}
          </span>
          <span>{t('pulls.updatedAt', { time: relative(row.updatedAt, now) })}</span>
        </div>
        {failing.length ? (
          <div className="pulls-failing">
            {failing.slice(0, 3).map((check) =>
              check.url ? (
                <a key={check.name} href={check.url} target="_blank" rel="noreferrer">
                  {check.name}
                </a>
              ) : (
                <span key={check.name}>{check.name}</span>
              )
            )}
            {failing.length > 3 ? <span>+{failing.length - 3}</span> : null}
          </div>
        ) : null}
      </div>
      <div className="pulls-badges">
        {row.conflicted && row.state !== 'merged' && row.state !== 'closed' ? (
          <span className="pulls-badge bad">{t('pulls.conflicted')}</span>
        ) : null}
        {row.review && row.state !== 'merged' && row.state !== 'closed' ? (
          <span className={`pulls-badge review ${row.review}`}>
            {t(`pulls.review.${row.review}`)}
          </span>
        ) : null}
        <span className={`pulls-badge state ${row.state}`}>{t(`pulls.state.${row.state}`)}</span>
      </div>
      {worker && worker.status !== 'removed' ? (
        <Button
          size="custom"
          variant="ghost"
          className="pulls-worker"
          aria-label={`${t('pulls.openWorker')}: ${workerTitle(worker)}`}
          onClick={() => showPanel({ kind: 'worker', workerId: worker.id })}
        >
          <OwlAvatar speaker={worker.provider} />
          <span>{workerTitle(worker)}</span>
        </Button>
      ) : (
        <span className="pulls-worker gone">
          {worker ? <OwlAvatar speaker={worker.provider} /> : null}
          <span>{worker ? workerTitle(worker) : t('pulls.removedWorker')}</span>
        </span>
      )}
    </li>
  )
}

/** Projects whose pull requests could not be read, each with why. */
function Issues({ projects }: { projects: Project[] }) {
  const { t } = useTranslation()
  const overview = usePullRequestsStore((s) => s.overview)
  if (overview?.kind !== 'ready') return null
  const issues = overview.projects.flatMap(({ projectId, status }) => {
    const project = projects.find((p) => p.id === projectId)
    if (!project) return []
    if (status.kind === 'not-installed' || status.kind === 'no-access')
      return [
        {
          projectId,
          install: status.kind === 'not-installed',
          text: t(`pulls.issue.${status.kind}`, {
            project: project.name,
            repository: `${status.owner}/${status.name}`
          })
        }
      ]
    if (status.kind === 'failed')
      return [
        {
          projectId,
          install: false,
          text: t(`pulls.issue.${status.reason}`, { project: project.name })
        }
      ]
    return []
  })
  if (!issues.length) return null
  return (
    <ul className="pulls-issues">
      {issues.map((issue) => (
        <li key={issue.projectId}>
          <span>{issue.text}</span>
          {issue.install ? (
            <a href={GITHUB_APP_INSTALL_URL} target="_blank" rel="noreferrer">
              {t('pulls.install')}
            </a>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

export function PullRequestsView() {
  const { t } = useTranslation()
  const now = useMinuteClock()
  const relative = useRelativeTime()
  const projects = useAppStore((s) => s.projects)
  const account = useAppStore((s) => s.github.status)
  const showSettings = useAppStore((s) => s.showSettings)
  const { overview, loading, failed, refresh, state, checks, projectId, sort } =
    usePullRequestsStore()
  // Reading again on a new connection answers at once instead of at the next poll.
  useEffect(() => (account === 'pending' ? undefined : watchPullRequests()), [account])
  const rows = useMemo(() => pullRequestRows(overview), [overview])
  const visible = useMemo(
    () => listPullRequests(rows, { state, checks, projectId }, sort),
    [rows, state, checks, projectId, sort]
  )
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])
  const signedOut = overview?.kind === 'signed-out'
  return (
    <main className="owlto-chat pulls-view">
      <header className="owlto-topbar router-topbar">
        <div className="router-thread-heading">
          <strong>{t('pulls.title')}</strong>
          <span>{t('pulls.subtitle')}</span>
        </div>
        <div className="owlto-topbar-actions">
          {overview?.kind === 'ready' ? (
            <span className="pulls-updated">
              {t('pulls.updatedAt', { time: relative(overview.fetchedAt, now) })}
            </span>
          ) : null}
          <ActionIconButton
            size="sm"
            label={t('pulls.refresh')}
            tooltip={t('pulls.refresh')}
            tooltipSide="bottom"
            icon={<RefreshIcon size={16} />}
            pending={loading}
            onAction={refresh}
          />
        </div>
      </header>
      <div className="pulls-body">
        {signedOut ? (
          <div className="pulls-empty">
            <p>{t('pulls.signedOut')}</p>
            <Button size="sm" onClick={() => showSettings('github')}>
              {t('pulls.connect')}
            </Button>
          </div>
        ) : (
          <>
            <Toolbar rows={rows} projects={projects} />
            {failed ? <p className="pulls-note">{t('pulls.failed')}</p> : null}
            <Issues projects={projects} />
            {!overview ? (
              <p className="pulls-note">{t('pulls.loading')}</p>
            ) : visible.length ? (
              <ul className="pulls-list" aria-label={t('pulls.list')}>
                {visible.map((row) => (
                  <Row
                    key={`${row.projectId}:${row.number}`}
                    row={row}
                    project={projectById.get(row.projectId)}
                    now={now}
                  />
                ))}
              </ul>
            ) : (
              <div className="pulls-empty">
                <p>{rows.length ? t('pulls.noMatch') : t('pulls.empty')}</p>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}
