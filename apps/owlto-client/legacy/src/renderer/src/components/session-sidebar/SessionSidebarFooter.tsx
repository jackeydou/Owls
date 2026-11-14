import { useI18n } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import type { LanguageSetting } from '@renderer/stores/settings-store'
import { Globe2, Settings } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemCheck,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '../ui/dropdown-menu'
import { SidebarFooter } from '../ui/sidebar'

type SettingsSource = 'account_menu' | 'footer_button'

export function SessionSidebarFooter({
  collapsed,
  settingsLanguage,
  accountMenuOpen,
  settingsActive,
  onAccountMenuOpenChange,
  onOpenSettings,
  onSelectLanguage
}: {
  collapsed: boolean
  settingsLanguage: LanguageSetting
  accountMenuOpen: boolean
  settingsActive: boolean
  onAccountMenuOpenChange: (open: boolean) => void
  onOpenSettings: (source: SettingsSource) => void
  onSelectLanguage: (language: LanguageSetting) => void
}): React.JSX.Element {
  const { t } = useI18n()

  return (
    <SidebarFooter className="border-t-0 px-2 pt-0 pb-2">
      <DropdownMenu open={accountMenuOpen} onOpenChange={onAccountMenuOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t('nav.settings')}
            className={cn(
              'flex h-9 w-full min-w-0 items-center rounded-lg text-muted-foreground transition hover:bg-sidebar-hover hover:text-foreground',
              collapsed ? 'justify-center px-0' : 'gap-2 px-2 text-left',
              settingsActive && 'bg-sidebar-active text-foreground'
            )}
          >
            <Settings className="size-4 shrink-0" strokeWidth={1.75} />
            {!collapsed ? (
              <span className="truncate text-[13px] font-medium">{t('nav.settings')}</span>
            ) : null}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side={collapsed ? 'right' : 'top'} className="w-52">
          <DropdownMenuItem
            onSelect={() => onOpenSettings('account_menu')}
            className="text-[14px] text-foreground/92"
          >
            <Settings className="size-4 shrink-0" strokeWidth={1.75} />
            {t('nav.settings')}
          </DropdownMenuItem>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="text-[14px] text-foreground/92">
              <span className="flex min-w-0 items-center gap-2">
                <Globe2 className="size-4 shrink-0" strokeWidth={1.75} />
                {t('general.language.label')}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-44">
              {(['auto', 'en', 'zh-CN'] as const).map((value) => (
                <DropdownMenuItem
                  key={value}
                  selected={settingsLanguage === value}
                  onSelect={() => onSelectLanguage(value)}
                  className="justify-between text-[14px] text-foreground/92"
                >
                  <span>
                    {t(
                      value === 'auto'
                        ? 'general.language.auto'
                        : value === 'en'
                          ? 'general.language.en'
                          : 'general.language.zhCN'
                    )}
                  </span>
                  <DropdownMenuItemCheck visible={settingsLanguage === value} />
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarFooter>
  )
}
