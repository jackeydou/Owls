import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Switch } from '@renderer/components/ui/switch'
import { useI18n } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { LayoutGrid, Paperclip, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { InstalledPlugin } from '../../../../preload/index.d'
import { orderInstalledPluginsForComposer } from './chat-composer-utils'
import { type ComposerContextTag, pluginToContextTag } from './context-tags'

const MENU_CONTENT_CLASS = 'rounded-xl p-1 text-[13px] leading-4'
const MENU_SUB_CONTENT_CLASS =
  'max-h-[280px] w-56 overflow-y-auto rounded-xl p-1 text-[13px] leading-4'
const MENU_ITEM_CLASS = 'gap-2 rounded-lg px-2.5 text-[13px] leading-4'
const MENU_ICON_CLASS = 'size-4 shrink-0 text-muted-foreground'
const PLUGIN_ICON_CLASS =
  'flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-[4px] text-[9px] font-semibold text-muted-foreground'
const TRIGGER_CLASS =
  'flex size-[var(--pichu-composer-button-size)] items-center justify-center rounded-full text-muted-foreground transition hover:bg-codex-light-button-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-codex-dark-button-secondary-hover'

export function ComposerAddMenu({
  ready,
  installedPlugins,
  recentPluginIds,
  onOpen,
  onPickAttachments,
  onSelectPlugin,
  onTogglePlugin,
  pluginToggleBusyId
}: {
  ready: boolean
  installedPlugins: InstalledPlugin[]
  recentPluginIds: readonly string[]
  onOpen: () => void
  onPickAttachments: () => void
  onSelectPlugin: (tag: Extract<ComposerContextTag, { kind: 'plugin' }>) => void
  onTogglePlugin: (plugin: InstalledPlugin) => void
  pluginToggleBusyId: string | null
}): React.JSX.Element {
  const { t } = useI18n()
  const [frozenPluginIds, setFrozenPluginIds] = useState<string[] | null>(null)
  const installedPluginMenuItems = useMemo(() => {
    return orderInstalledPluginsForComposer(installedPlugins, recentPluginIds, frozenPluginIds)
  }, [frozenPluginIds, installedPlugins, recentPluginIds])
  const enabledPluginCount = installedPluginMenuItems.filter((plugin) => plugin.enabled).length

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) {
          onOpen()
          setFrozenPluginIds(
            (current) => current ?? installedPluginMenuItems.map((plugin) => plugin.id)
          )
        } else {
          setFrozenPluginIds(null)
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={TRIGGER_CLASS}
          disabled={!ready}
          aria-label={t('chat.composer.addMenu')}
        >
          <Plus className="size-5" strokeWidth={1.8} aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" sideOffset={8} className={MENU_CONTENT_CLASS}>
        <DropdownMenuItem className={MENU_ITEM_CLASS} onSelect={onPickAttachments}>
          <Paperclip className={MENU_ICON_CLASS} strokeWidth={1.8} aria-hidden />
          <span className="truncate">{t('chat.attachment.addPhotosFiles')}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className={MENU_ITEM_CLASS}>
            <span className="flex min-w-0 items-center gap-2">
              <LayoutGrid className={MENU_ICON_CLASS} strokeWidth={1.8} aria-hidden />
              <span className="truncate">{t('chat.mention.plugins')}</span>
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            verticalAlign="bottom"
            sideOffset={4}
            className={MENU_SUB_CONTENT_CLASS}
          >
            <DropdownMenuLabel className="px-2.5 pt-1.5 pb-1 text-[12px] leading-4">
              {t('chat.plugins.enabledInstalledCount', {
                enabled: enabledPluginCount,
                installed: installedPluginMenuItems.length
              })}
            </DropdownMenuLabel>
            {installedPluginMenuItems.length > 0 ? (
              installedPluginMenuItems.map((plugin) => {
                const tag = pluginToContextTag(plugin)
                return (
                  <div key={plugin.id} className="flex h-7 items-center gap-1.5 rounded-lg px-2.5">
                    <DropdownMenuItem
                      disabled={!plugin.enabled}
                      className="min-w-0 flex-1 gap-2 rounded-lg px-0 text-[13px] leading-4 data-[disabled]:pointer-events-none data-[disabled]:opacity-70"
                      onSelect={() => onSelectPlugin(tag)}
                    >
                      <span className={cn(PLUGIN_ICON_CLASS, !plugin.enabled && 'opacity-60')}>
                        {tag.iconUrl ? (
                          <img
                            src={tag.iconUrl}
                            alt=""
                            className={cn(
                              'size-full rounded-[4px] object-cover',
                              !plugin.enabled && 'grayscale'
                            )}
                          />
                        ) : (
                          <span>@</span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                    </DropdownMenuItem>
                    <Switch
                      size="sm"
                      checked={plugin.enabled}
                      disabled={pluginToggleBusyId === plugin.id}
                      aria-label={
                        plugin.enabled ? t('plugins.action.disable') : t('plugins.action.enable')
                      }
                      onPointerDown={(event) => {
                        event.stopPropagation()
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.stopPropagation()
                        }
                      }}
                      onClick={(event) => {
                        event.stopPropagation()
                      }}
                      onCheckedChange={() => onTogglePlugin(plugin)}
                    />
                  </div>
                )
              })
            ) : (
              <DropdownMenuItem disabled className={MENU_ITEM_CLASS}>
                {t('chat.plugins.noneInstalled')}
              </DropdownMenuItem>
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
