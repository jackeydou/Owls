import { type I18nKey, useI18n } from '@renderer/lib/i18n'
import { Box, CirclePlus } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import type { SkillSummary } from '../../../../preload/index.d'
import {
  ComposerPickerIcon,
  ComposerPickerPopup,
  ComposerPickerRow,
  ComposerPickerScrollArea,
  ComposerPickerSection,
  ComposerPickerText
} from './ComposerPicker'
import { formatSkillDisplayTitle } from './skill-display'

function sourceLabel(skill: SkillSummary, t: (key: I18nKey) => string): string {
  if (skill.sourceKind === 'plugin') {
    return skill.pluginName ?? t('chat.skill.source.plugin')
  }
  if (skill.sourceKind === 'builtin') {
    return t('chat.skill.source.builtin')
  }
  if (skill.sourceKind === 'repo') {
    return skill.sourceLabel || t('chat.skill.source.project')
  }
  return t('chat.skill.source.personal')
}

function queryMatchIndexes(value: string, query: string): Set<number> {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return new Set()

  const normalizedValue = value.toLowerCase()
  const indexes = new Set<number>()
  let searchFrom = 0

  for (const character of normalizedQuery) {
    const index = normalizedValue.indexOf(character, searchFrom)
    if (index === -1) return new Set()
    indexes.add(index)
    searchFrom = index + character.length
  }

  return indexes
}

function highlightedText(value: string, query: string): ReactNode {
  const indexes = queryMatchIndexes(value, query)
  if (indexes.size === 0) {
    return query ? <span className="text-muted-foreground">{value}</span> : value
  }

  return Array.from(value).map((character, index) => (
    <span
      // biome-ignore lint/suspicious/noArrayIndexKey: The source text is immutable for this render.
      key={index}
      className={indexes.has(index) ? 'text-foreground' : 'text-muted-foreground'}
    >
      {character}
    </span>
  ))
}

function mutedText(value: string): ReactNode {
  return <span className="text-muted-foreground">{value}</span>
}

export function SkillPickerPopup({
  open,
  sideChatCommandDescription,
  sideChatCommandEnabled,
  showSideChatCommand,
  skills,
  highlightedIndex,
  loading,
  query,
  onHighlight,
  onSelectSideChatCommand,
  onSelect
}: {
  open: boolean
  sideChatCommandDescription: string
  sideChatCommandEnabled: boolean
  showSideChatCommand: boolean
  skills: SkillSummary[]
  highlightedIndex: number
  loading: boolean
  query: string
  onHighlight: (index: number) => void
  onSelectSideChatCommand: () => void
  onSelect: (skill: SkillSummary) => void
}): React.JSX.Element | null {
  const { t } = useI18n()
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const hasItems = showSideChatCommand || skills.length > 0

  useEffect(() => {
    if (!open) return
    const activeItem = scrollContainerRef.current?.querySelector<HTMLElement>(
      `[data-skill-index="${highlightedIndex}"]`
    )
    activeItem?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex, open])

  if (!open) return null

  return (
    <ComposerPickerPopup>
      {loading && !showSideChatCommand ? (
        <div className="px-1.5 py-1 text-[13px] leading-4 text-muted-foreground">
          {t('chat.skill.loading')}
        </div>
      ) : !hasItems ? (
        <div className="px-1.5 py-1 text-[13px] leading-4 text-muted-foreground">
          {query ? t('chat.skill.noMatches') : t('chat.skill.empty')}
        </div>
      ) : (
        <ComposerPickerScrollArea scrollRef={scrollContainerRef}>
          {showSideChatCommand ? (
            <div className="space-y-0.5 pb-0.5">
              <ComposerPickerRow
                index={0}
                highlightedIndex={highlightedIndex}
                indexAttribute="data-skill-index"
                ariaLabel={`${t('chat.sideCommand.title')}. ${sideChatCommandDescription}.`}
                disabled={!sideChatCommandEnabled}
                onHighlight={onHighlight}
                onMouseDown={onSelectSideChatCommand}
              >
                <ComposerPickerIcon>
                  <CirclePlus className="size-3.5" strokeWidth={1.9} aria-hidden />
                </ComposerPickerIcon>
                <ComposerPickerText
                  title={highlightedText(t('chat.sideCommand.title'), query)}
                  subtitle={mutedText(sideChatCommandDescription)}
                />
              </ComposerPickerRow>
            </div>
          ) : null}
          {loading ? (
            <div className="px-1.5 py-1 text-[13px] leading-4 text-muted-foreground">
              {t('chat.skill.loading')}
            </div>
          ) : skills.length > 0 ? (
            <ComposerPickerSection title={t('chat.skill.title')}>
              <div className="space-y-0.5">
                {skills.map((skill, index) => {
                  const displayName = formatSkillDisplayTitle(skill.name)
                  const displaySource = sourceLabel(skill, t)
                  const title = highlightedText(displayName, query)
                  const subtitle = query ? mutedText(skill.description) : skill.description
                  const pickerIndex = showSideChatCommand ? index + 1 : index

                  return (
                    <ComposerPickerRow
                      key={skill.qualifiedName ?? skill.filePath}
                      index={pickerIndex}
                      highlightedIndex={highlightedIndex}
                      indexAttribute="data-skill-index"
                      ariaLabel={`${displayName}. ${skill.description}. ${displaySource}.`}
                      onHighlight={onHighlight}
                      onMouseDown={() => onSelect(skill)}
                    >
                      <ComposerPickerIcon>
                        <Box className="size-3.5" strokeWidth={1.8} aria-hidden />
                      </ComposerPickerIcon>
                      <ComposerPickerText title={title} subtitle={subtitle} meta={displaySource} />
                    </ComposerPickerRow>
                  )
                })}
              </div>
            </ComposerPickerSection>
          ) : null}
        </ComposerPickerScrollArea>
      )}
    </ComposerPickerPopup>
  )
}
