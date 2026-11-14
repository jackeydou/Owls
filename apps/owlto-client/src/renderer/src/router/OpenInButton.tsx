import {
  AlertCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  LoaderIcon
} from '@renderer/components/ui/icons'
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger
} from '@renderer/components/ui/menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useAction } from '@renderer/components/ui/use-action'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { OpenInApp } from '../../../shared/open-in'
import type { RouterWorker } from '../../../shared/router'
import { useAppStore } from '../app/store'
import { useRouterStore } from './store'

/** The app's own icon, read from its bundle; a letter tile when macOS gave none. */
function AppIcon({ app, size }: { app: OpenInApp; size: number }) {
  return app.icon ? (
    <img src={app.icon} alt="" width={size} height={size} draggable={false} />
  ) : (
    <span className="open-in-letter" style={{ width: size, height: size }} aria-hidden>
      {app.name.slice(0, 1)}
    </span>
  )
}

/** Menu groups in catalog order: editors, then the file manager, then terminals. */
function groups(apps: OpenInApp[]): OpenInApp[][] {
  const result: OpenInApp[][] = []
  for (const app of apps) {
    const last = result.at(-1)
    if (last && last[0].kind === app.kind) last.push(app)
    else result.push([app])
  }
  return result
}

/**
 * "Open in" for a worker's folder: the main half opens it in the remembered app,
 * the chevron lists every installed editor, file manager, and terminal. Picking
 * one opens the folder there and makes it the default.
 */
export function OpenInButton({ worker }: { worker: RouterWorker }) {
  const { t } = useTranslation()
  const apps = useRouterStore((s) => s.openInApps)
  const loadOpenInApps = useRouterStore((s) => s.loadOpenInApps)
  const openWorkerIn = useRouterStore((s) => s.openWorkerIn)
  const settings = useAppStore((s) => s.settings)
  const saveSettings = useAppStore((s) => s.saveSettings)
  const target = useRef<OpenInApp | null>(null)
  const current =
    apps?.find((app) => app.id === settings.openInApp) ??
    apps?.find((app) => app.kind === 'editor') ??
    apps?.[0] ??
    null
  const { phase, run } = useAction(async () => {
    const app = target.current ?? current
    target.current = null
    if (!app) return 'quiet'
    if (app.id !== settings.openInApp) void saveSettings({ ...settings, openInApp: app.id })
    const opened = await openWorkerIn({
      routerId: worker.routerId,
      workerId: worker.id,
      appId: app.id
    })
    if (!opened) throw new Error('open failed')
    return 'done'
  })

  useEffect(() => {
    if (apps === null) void loadOpenInApps()
  }, [apps, loadOpenInApps])

  // A released worktree has no folder left to open.
  if (worker.workspace.kind === 'worktree' && worker.workspace.state === 'released') return null
  if (!current || !apps) return null
  const label = t('openIn.open', { app: current.name })
  return (
    // biome-ignore lint/a11y/useSemanticElements: a split button is a group of two buttons, not a fieldset.
    <div className="open-in" role="group" aria-label={t('openIn.menuLabel')}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="open-in-main"
            aria-label={label}
            aria-busy={phase === 'pending' || undefined}
            disabled={phase === 'pending'}
            onClick={() => void run()}
          >
            {phase === 'pending' ? (
              <LoaderIcon size={15} className="animate-spin" aria-hidden />
            ) : phase === 'done' ? (
              <CheckIcon size={15} aria-hidden />
            ) : phase === 'failed' ? (
              <AlertCircleIcon size={15} aria-hidden />
            ) : (
              <AppIcon app={current} size={18} />
            )}
            <span className="open-in-text">{t('openIn.short')}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
      <Menu
        onOpenChange={(open) => {
          // Picks up an app installed while Owlto was running; main rescans at most once a minute.
          if (open) void loadOpenInApps()
        }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <MenuTrigger asChild>
              <button
                type="button"
                className="open-in-more"
                aria-label={t('openIn.choose')}
                disabled={phase === 'pending'}
              >
                <ChevronDownIcon size={13} aria-hidden />
              </button>
            </MenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('openIn.choose')}</TooltipContent>
        </Tooltip>
        <MenuContent align="end" className="min-w-[200px]">
          <MenuLabel>{t('openIn.menuLabel')}</MenuLabel>
          {groups(apps).map((group, index) => (
            <MenuGroup key={group[0].kind}>
              {index > 0 ? <MenuSeparator /> : null}
              {group.map((app) => (
                <MenuItem
                  key={app.id}
                  onSelect={() => {
                    target.current = app
                    void run()
                  }}
                >
                  <AppIcon app={app} size={18} />
                  <span className="min-w-0 flex-1 truncate">{app.name}</span>
                  {app.id === current.id ? <CheckIcon size={14} aria-hidden /> : null}
                </MenuItem>
              ))}
            </MenuGroup>
          ))}
        </MenuContent>
      </Menu>
    </div>
  )
}
