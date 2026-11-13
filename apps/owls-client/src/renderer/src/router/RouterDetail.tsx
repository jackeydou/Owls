import { ActionButton } from '@renderer/components/ui/action-button'
import { Button } from '@renderer/components/ui/button'
import { IconButton } from '@renderer/components/ui/icon-button'
import { SettingsIcon, XIcon } from '@renderer/components/ui/icons'
import { useTranslation } from 'react-i18next'
import type { Router } from '../../../shared/app'
import { useAppStore } from '../app/store'
import { workerTitle } from './activity'
import { useRouterStore } from './store'

export function RouterDetail({ router }: { router: Router | undefined }) {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const showRouterSettings = useAppStore((s) => s.showRouterSettings)
  const { discardWorktree, showPanel } = useRouterStore()
  const workers = useRouterStore((s) => s.workers)
  const { engine } = settings.router
  const model =
    engine === 'owls'
      ? settings.router.owls?.model
      : engine === 'claude-code'
        ? settings.router.claudeModel
        : settings.router.codexModel
  // Removed workers whose worktrees still hold uncommitted changes (RFC 11.1).
  const kept = workers.filter(
    (w) =>
      w.routerId === router?.id &&
      w.status === 'removed' &&
      w.workspace.kind === 'worktree' &&
      w.workspace.state === 'kept'
  )
  return (
    <aside className="router-panel" aria-label={t('router.details')}>
      <header>
        <div>
          <h2>
            <span>{t('router.details')}</span>
          </h2>
        </div>
        <IconButton
          size="sm"
          label={t('worker.close')}
          tooltip={t('worker.close')}
          icon={<XIcon size={17} />}
          onClick={() => showPanel(null)}
        />
      </header>
      <div className="router-panel-body">
        <dl className="router-facts">
          <dt>{t('routerSettings.engine')}</dt>
          <dd className="router-model">{t(`router.engineLabel.${engine}`)}</dd>
          <dt>{t('routerSettings.model')}</dt>
          <dd>{model ?? t('router.cliDefaultModel')}</dd>
          {router?.tokens ? (
            <>
              <dt>{t('router.usage')}</dt>
              <dd>{t('router.tokens', { count: router.tokens })}</dd>
            </>
          ) : null}
        </dl>
        <Button size="sm" variant="outline" onClick={() => showRouterSettings('router')}>
          <SettingsIcon size={16} />
          {t('router.openSettings')}
        </Button>
        {router && kept.length ? (
          <section className="router-kept" aria-label={t('router.keptWorktrees')}>
            <h3>{t('router.keptWorktrees')}</h3>
            <p>{t('router.keptWorktreesBody')}</p>
            <ul>
              {kept.map((worker) =>
                worker.workspace.kind === 'worktree' ? (
                  <li key={worker.id}>
                    <span>
                      <strong>{workerTitle(worker)}</strong>
                      <small>
                        {worker.workspace.branch} · {worker.workspace.path}
                      </small>
                    </span>
                    <ActionButton
                      size="sm"
                      variant="outline"
                      aria-label={t('router.discardWorktreeLabel', { goal: workerTitle(worker) })}
                      onAction={() => discardWorktree(router.id, worker.id)}
                    >
                      {t('router.discardWorktree')}
                    </ActionButton>
                  </li>
                ) : null
              )}
            </ul>
          </section>
        ) : null}
      </div>
    </aside>
  )
}
