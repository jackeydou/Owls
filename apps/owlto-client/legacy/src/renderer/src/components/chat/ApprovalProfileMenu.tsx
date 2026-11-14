import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { useI18n } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { Check, ChevronDown, Hand, ShieldAlert, ShieldCheck } from 'lucide-react'
import {
  type AgentTrustProfile,
  normalizeAgentTrustProfile
} from '../../../../shared/tool-approval'

const PROFILE_ORDER: AgentTrustProfile[] = ['ask', 'auto', 'full']

const PROFILE_ICONS = {
  ask: Hand,
  auto: ShieldCheck,
  full: ShieldAlert
} satisfies Record<AgentTrustProfile, typeof Hand>

const SELECTED_COLOR_CLASS = {
  ask: 'text-muted-foreground',
  auto: 'text-[#0969da] dark:text-[#58a6ff]',
  full: 'text-orange-600 dark:text-orange-400'
} satisfies Record<AgentTrustProfile, string>

export function ApprovalProfileMenu({
  value,
  onChange,
  disabled
}: {
  value: AgentTrustProfile
  onChange: (value: AgentTrustProfile) => void
  disabled?: boolean
}): React.JSX.Element {
  const { t } = useI18n()
  const selectedValue = normalizeAgentTrustProfile(value)
  const SelectedIcon = PROFILE_ICONS[selectedValue]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'inline-flex h-[26px] max-w-full items-center gap-1.5 rounded-full px-2 text-[13px] leading-[18px] font-[400] tracking-normal transition',
            'hover:bg-codex-light-button-secondary disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-codex-dark-button-secondary-hover',
            SELECTED_COLOR_CLASS[selectedValue]
          )}
          aria-label={t('approvalProfile.ariaLabel')}
        >
          <SelectedIcon className="size-[14px] shrink-0" strokeWidth={1.8} aria-hidden />
          <span className="truncate">{t(`approvalProfile.${selectedValue}.title`)}</span>
          <ChevronDown className="size-[13px] shrink-0" strokeWidth={1.8} aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={8}
        className="w-max max-w-[calc(100vw-32px)] rounded-xl px-1 py-1"
      >
        {PROFILE_ORDER.map((profile) => {
          const Icon = PROFILE_ICONS[profile]
          const selected = profile === selectedValue
          return (
            <DropdownMenuItem
              key={profile}
              className="grid min-h-0 grid-cols-[16px_minmax(max-content,1fr)_16px] items-center gap-x-2 gap-y-0.5 rounded-md px-1.5 py-1 text-foreground tracking-normal data-[highlighted]:bg-foreground/[0.035] dark:data-[highlighted]:bg-white/[0.055]"
              onSelect={() => onChange(profile)}
            >
              <Icon
                className="row-span-2 size-4 self-center text-foreground"
                strokeWidth={1.75}
                aria-hidden
              />
              <span className="text-[13px] leading-[16px] font-[400] tracking-normal text-foreground">
                {t(`approvalProfile.${profile}.title`)}
              </span>
              <span className="row-span-2 flex size-4 items-center justify-center self-center">
                {selected ? (
                  <Check className="size-4 text-foreground" strokeWidth={1.8} aria-hidden />
                ) : null}
              </span>
              <span className="text-[13px] leading-[15px] font-[400] tracking-normal text-muted-foreground">
                {t(`approvalProfile.${profile}.description`)}
              </span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
