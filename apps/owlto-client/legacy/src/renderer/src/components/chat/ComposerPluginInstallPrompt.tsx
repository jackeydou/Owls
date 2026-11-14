import { IconButton } from '@renderer/components/ui/icon-button'
import { useI18n } from '@renderer/lib/i18n'
import { pluginIconUrl } from '@renderer/lib/plugin-assets'
import { Download, RefreshCcw, X } from 'lucide-react'
import type { PluginInstallPrompt } from './chat-composer-types'

export function ComposerPluginInstallPrompt({
  busy,
  error,
  onAction,
  onDismiss,
  prompt
}: {
  busy: boolean
  error: string | null
  onAction: (prompt: PluginInstallPrompt) => void
  onDismiss: (key: string) => void
  prompt: PluginInstallPrompt
}): React.JSX.Element {
  const { t } = useI18n()
  const ActionIcon = prompt.action === 'install' ? Download : RefreshCcw
  const iconUrl = pluginIconUrl(prompt.installed ?? prompt.entry)

  return (
    <div className="relative z-0 mx-7 mb-[-1px] overflow-hidden rounded-t-[18px] border border-b-0 border-border/70 bg-card/85 px-3 py-1.5 shadow-sm sm:mx-10">
      <div className="flex min-w-0 items-center gap-1.5">
        <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-codex-blue-400/10 text-codex-blue-400">
          {iconUrl ? (
            <img src={iconUrl} alt="" className="size-[18px] rounded object-cover" />
          ) : (
            <ActionIcon className="size-3.5" strokeWidth={2} aria-hidden />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-medium leading-4 text-foreground">
            {prompt.action === 'install'
              ? t('chat.pluginPrompt.installTitle', {
                  plugin: prompt.title
                })
              : t('chat.pluginPrompt.updateTitle', {
                  plugin: prompt.title
                })}
          </div>
          {error ? (
            <div className="truncate text-[11px] leading-4 text-destructive">{error}</div>
          ) : prompt.action === 'update' && prompt.fromVersion && prompt.toVersion ? (
            <div className="truncate text-[11px] leading-4 text-muted-foreground">
              {t('chat.pluginPrompt.updateVersion', {
                from: prompt.fromVersion,
                to: prompt.toVersion
              })}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => onAction(prompt)}
          className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-foreground px-2.5 text-[12px] font-medium leading-none text-background transition hover:bg-foreground/90 disabled:cursor-wait disabled:bg-muted-foreground/25 disabled:text-background/60"
        >
          <ActionIcon className="size-3.5" strokeWidth={2} aria-hidden />
          <span>
            {busy
              ? t('chat.pluginPrompt.working')
              : prompt.action === 'install'
                ? t('chat.pluginPrompt.install')
                : t('chat.pluginPrompt.update')}
          </span>
        </button>
        <IconButton
          label={t('chat.pluginPrompt.dismiss')}
          icon={<X className="size-3.5" strokeWidth={2} aria-hidden />}
          variant="unstyled"
          size="custom"
          className="size-6 shrink-0 text-muted-foreground transition hover:bg-card-muted hover:text-foreground"
          onClick={() => onDismiss(prompt.key)}
        />
      </div>
    </div>
  )
}
