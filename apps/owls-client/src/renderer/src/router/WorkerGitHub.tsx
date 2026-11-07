import { Button } from '@renderer/components/ui/button'
import {
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CircleMinus,
  CircleX,
  GitPullRequest,
  type LucideIcon
} from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  GITHUB_APP_INSTALL_URL,
  type WorkerCheckState,
  type WorkerPullRequest
} from '../../../shared/github'
import type { RouterWorker } from '../../../shared/router'
import { useCodexStore } from '../codex/store'
import { useRouterStore } from './store'

const CHECK_ICONS: Record<WorkerCheckState, LucideIcon> = {
  success: CircleCheck,
  failure: CircleX,
  pending: CircleDashed,
  neutral: CircleMinus
}

function CheckIcon({ state }: { state: WorkerCheckState }) {
  const Icon = CHECK_ICONS[state]
  return <Icon size={13} className={`router-github-check ${state}`} aria-hidden />
}

function Checks({ pullRequest }: { pullRequest: WorkerPullRequest }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { checks, checksState } = pullRequest
  if (!checksState) return <span>{t('github.checks.none')}</span>
  const failing = checks.filter((check) => check.state === 'failure').length
  return (
    <>
      <Button
        size="custom"
        variant="ghost"
        className="router-github-summary"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <CheckIcon state={checksState} />
        <span>{t(`github.checks.${checksState}`, { count: failing })}</span>
        <ChevronRight size={12} className={open ? 'open' : undefined} aria-hidden />
      </Button>
      {open ? (
        <ul className="router-github-checks">
          {checks.map((check) => (
            <li key={`${check.name}:${check.url}`}>
              <CheckIcon state={check.state} />
              {check.url ? (
                <a href={check.url} target="_blank" rel="noreferrer">
                  {check.name}
                </a>
              ) : (
                <span>{check.name}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  )
}

function PullRequestStatus({ pullRequest }: { pullRequest: WorkerPullRequest }) {
  const { t } = useTranslation()
  return (
    <>
      <div className="router-github-title">
        <GitPullRequest size={13} aria-hidden />
        <a href={pullRequest.url} target="_blank" rel="noreferrer">
          #{pullRequest.number} {pullRequest.title}
        </a>
        <span className={`router-github-state ${pullRequest.state}`}>
          {t(`github.state.${pullRequest.state}`)}
        </span>
      </div>
      <div className="router-github-meta">
        <Checks pullRequest={pullRequest} />
        {pullRequest.review ? <span>{t(`github.review.${pullRequest.review}`)}</span> : null}
        {pullRequest.conflicted ? (
          <span className="router-github-conflict">{t('github.conflicted')}</span>
        ) : null}
      </div>
    </>
  )
}

function Note({ children }: { children: ReactNode }) {
  return <p className="router-github-note">{children}</p>
}

/** The pull request and CI state of a worker's branch, below the panel's header. */
export function WorkerGitHub({ worker }: { worker: RouterWorker }) {
  const { t } = useTranslation()
  const { id, routerId } = worker
  const status = useRouterStore((s) => s.gitHub[id])
  const watchGitHub = useRouterStore((s) => s.watchGitHub)
  const showSettings = useCodexStore((s) => s.showSettings)
  const hasWorktree = worker.workspace.kind === 'worktree'
  useEffect(
    () => (hasWorktree ? watchGitHub(routerId, id) : undefined),
    [hasWorktree, id, routerId, watchGitHub]
  )
  if (!hasWorktree || status?.kind === 'unsupported') return null
  return (
    <section className="router-github" aria-label={t('github.title')}>
      {!status ? <Note>{t('github.loading')}</Note> : null}
      {status?.kind === 'signed-out' ? (
        <Note>
          <span>{t('github.signedOut')}</span>
          <Button
            size="custom"
            variant="link"
            className="router-github-action"
            onClick={() => showSettings('github')}
          >
            {t('github.connect')}
          </Button>
        </Note>
      ) : null}
      {status?.kind === 'not-installed' ? (
        <Note>
          <span>{t('github.notInstalled', { repository: `${status.owner}/${status.name}` })}</span>
          <a href={GITHUB_APP_INSTALL_URL} target="_blank" rel="noreferrer">
            {t('github.install')}
          </a>
        </Note>
      ) : null}
      {status?.kind === 'no-access' ? (
        <Note>{t('github.noAccess', { repository: `${status.owner}/${status.name}` })}</Note>
      ) : null}
      {status?.kind === 'not-pushed' ? <Note>{t('github.notPushed')}</Note> : null}
      {status?.kind === 'no-pull-request' ? <Note>{t('github.noPullRequest')}</Note> : null}
      {status?.kind === 'failed' ? <Note>{t(`github.failed.${status.reason}`)}</Note> : null}
      {status?.kind === 'pull-request' ? (
        <PullRequestStatus pullRequest={status.pullRequest} />
      ) : null}
    </section>
  )
}
