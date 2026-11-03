import { type I18nKey, useI18n } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { ChevronDown, Settings } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  PICHU_REASONING_MENU_LEVELS,
  type PichuReasoningMenuLevel,
  type PichuThinkingLevel
} from '../../../../shared/model-settings'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemCheck,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '../ui/dropdown-menu'

type ModelEntry = {
  id: string
  name: string
  reasoning?: boolean
  supportedThinkingLevels?: PichuReasoningMenuLevel[]
  defaultThinkingLevel?: PichuThinkingLevel
  hiddenFromModelSwitcher?: boolean
}

const THINKING_LABEL_KEYS: Record<PichuReasoningMenuLevel, I18nKey> = {
  low: 'model.reasoning.low',
  medium: 'model.reasoning.medium',
  high: 'model.reasoning.high',
  xhigh: 'model.reasoning.xhigh'
}

function compactModelName(name: string): string {
  return name.replace(/^GPT\s+/i, '')
}

export function ModelSwitcher({
  currentModelId,
  currentThinkingLevel,
  onSelect,
  onThinkingLevelSelect,
  disabled
}: {
  currentModelId: string
  currentThinkingLevel: PichuThinkingLevel
  onSelect: (modelId: string, defaultThinkingLevel?: PichuThinkingLevel) => void
  onThinkingLevelSelect: (level: PichuReasoningMenuLevel) => void
  disabled?: boolean
}): React.JSX.Element | null {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [models, setModels] = useState<ModelEntry[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    void window.api.agent.listModels().then(setModels).catch(console.error)
  }, [])

  const currentModel = models.find((m) => m.id === currentModelId)
  const label = currentModel?.name ?? (currentModelId || t('models.empty.title'))
  const currentModelThinkingLevels = currentModel?.supportedThinkingLevels ?? []
  const canSelectThinkingLevel =
    currentModel?.reasoning === true && currentModelThinkingLevels.length > 0
  const currentThinkingLabel =
    canSelectThinkingLevel && currentThinkingLevel in THINKING_LABEL_KEYS
      ? t(THINKING_LABEL_KEYS[currentThinkingLevel as PichuReasoningMenuLevel])
      : null
  const triggerModelLabel = currentModel ? compactModelName(currentModel.name) : label
  const visibleModels = models.filter((m) => !m.hiddenFromModelSwitcher)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'flex h-[var(--pichu-composer-button-size)] items-center gap-1 rounded-full px-2 !text-[12px] font-normal leading-4 text-muted-foreground transition-colors hover:bg-codex-light-button-secondary hover:text-muted-foreground focus-visible:bg-codex-light-button-secondary dark:hover:bg-codex-dark-button-secondary-hover dark:hover:text-muted-foreground dark:focus-visible:bg-codex-dark-button-secondary-hover disabled:pointer-events-none disabled:opacity-40',
            open &&
              'bg-codex-light-button-secondary text-muted-foreground dark:bg-codex-dark-button-secondary-hover'
          )}
          style={{ fontSize: 12 }}
        >
          <span className="max-w-[108px] truncate leading-4">
            {triggerModelLabel}
            {currentThinkingLabel ? (
              <span className="ml-1 text-muted-foreground/80">{currentThinkingLabel}</span>
            ) : null}
          </span>
          <ChevronDown className="size-3" strokeWidth={1.9} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={6}
        className="min-w-[168px] max-w-[220px]"
      >
        {canSelectThinkingLevel ? (
          <>
            <DropdownMenuLabel>{t('model.reasoning.label')}</DropdownMenuLabel>
            {PICHU_REASONING_MENU_LEVELS.filter((level) =>
              currentModelThinkingLevels.includes(level)
            ).map((level) => (
              <DropdownMenuItem
                key={level}
                selected={level === currentThinkingLevel}
                onSelect={() => onThinkingLevelSelect(level)}
              >
                <span className="min-w-0 flex-1 truncate">{t(THINKING_LABEL_KEYS[level])}</span>
                <DropdownMenuItemCheck visible={level === currentThinkingLevel} />
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        ) : null}
        {visibleModels.map((m) => (
          <DropdownMenuItem
            key={m.id}
            selected={m.id === currentModelId}
            onSelect={() => onSelect(m.id, m.defaultThinkingLevel)}
          >
            <span className="min-w-0 flex-1 truncate">{m.name}</span>
            <DropdownMenuItemCheck visible={m.id === currentModelId} />
          </DropdownMenuItem>
        ))}
        {visibleModels.length > 0 ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem onSelect={() => navigate('/settings/models')}>
          <Settings className="mr-2 size-3.5" />
          <span className="min-w-0 flex-1 truncate">{t('settings.tab.models')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
