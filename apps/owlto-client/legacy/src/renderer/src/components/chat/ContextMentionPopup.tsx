import { Switch } from '@renderer/components/ui/switch'
import { useI18n } from '@renderer/lib/i18n'
import { type ReactNode, useEffect, useRef } from 'react'
import {
  ComposerPickerIcon,
  ComposerPickerPopup,
  ComposerPickerRow,
  ComposerPickerScrollArea,
  ComposerPickerSection,
  ComposerPickerText
} from './ComposerPicker'
import type { ComposerContextTag } from './context-tags'

type PluginContextTag = Extract<ComposerContextTag, { kind: 'plugin' }>

function itemAvatar(tag: PluginContextTag): ReactNode {
  return tag.iconUrl ? (
    <img src={tag.iconUrl} alt="" className="size-full rounded-[5px] object-cover" />
  ) : (
    <span>@</span>
  )
}

function ContextSection({
  title,
  items,
  startIndex,
  highlightedIndex,
  onHighlight,
  onTogglePlugin,
  pluginToggleBusyId,
  onSelect
}: {
  title: string
  items: PluginContextTag[]
  startIndex: number
  pluginToggleBusyId?: string | null
  highlightedIndex: number
  onHighlight: (index: number) => void
  onTogglePlugin?: (tag: PluginContextTag) => void
  onSelect: (tag: PluginContextTag) => void
}): React.JSX.Element {
  const { t } = useI18n()

  return (
    <ComposerPickerSection title={title}>
      <div className="space-y-0.5">
        {items.map((tag, offset) => {
          const index = startIndex + offset
          const pluginDisabled = tag.enabled === false
          const pluginToggleBusy = pluginToggleBusyId === tag.id
          return (
            <ComposerPickerRow
              key={tag.id}
              index={index}
              highlightedIndex={highlightedIndex}
              indexAttribute="data-mention-index"
              ariaLabel={`${tag.name}. ${tag.description || tag.path}.`}
              disabled={pluginDisabled}
              onHighlight={onHighlight}
              onMouseDown={() => onSelect(tag)}
              trailing={
                <Switch
                  size="sm"
                  checked={tag.enabled !== false}
                  aria-label={
                    tag.enabled ? t('plugins.action.disable') : t('plugins.action.enable')
                  }
                  disabled={pluginToggleBusy}
                  onMouseEnter={() => onHighlight(index)}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                  onClick={(event) => {
                    event.stopPropagation()
                  }}
                  onCheckedChange={() => onTogglePlugin?.(tag)}
                />
              }
            >
              <ComposerPickerIcon>{itemAvatar(tag)}</ComposerPickerIcon>
              <ComposerPickerText
                title={
                  <span className={pluginDisabled ? 'text-muted-foreground' : undefined}>
                    {tag.name}
                  </span>
                }
                subtitle={tag.description || tag.path}
              />
            </ComposerPickerRow>
          )
        })}
      </div>
    </ComposerPickerSection>
  )
}

export function ContextMentionPopup({
  open,
  pluginTags,
  highlightedIndex,
  onHighlight,
  onTogglePlugin,
  pluginToggleBusyId,
  onSelect
}: {
  open: boolean
  pluginTags: PluginContextTag[]
  highlightedIndex: number
  onHighlight: (index: number) => void
  onTogglePlugin: (tag: PluginContextTag) => void
  pluginToggleBusyId: string | null
  onSelect: (tag: PluginContextTag) => void
}): React.JSX.Element | null {
  const { t } = useI18n()
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const activeItem = scrollContainerRef.current?.querySelector<HTMLElement>(
      `[data-mention-index="${highlightedIndex}"]`
    )
    activeItem?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex, open])

  if (!open) return null

  return (
    <ComposerPickerPopup>
      <ComposerPickerScrollArea scrollRef={scrollContainerRef}>
        {pluginTags.length > 0 ? (
          <ContextSection
            title={t('chat.mention.plugins')}
            items={pluginTags}
            startIndex={0}
            highlightedIndex={highlightedIndex}
            onHighlight={onHighlight}
            onSelect={onSelect}
            onTogglePlugin={onTogglePlugin}
            pluginToggleBusyId={pluginToggleBusyId}
          />
        ) : null}
        {pluginTags.length === 0 ? (
          <div className="px-1.5 py-1 text-[13px] leading-4 text-muted-foreground">
            {t('chat.mention.noResults')}
          </div>
        ) : null}
      </ComposerPickerScrollArea>
    </ComposerPickerPopup>
  )
}
