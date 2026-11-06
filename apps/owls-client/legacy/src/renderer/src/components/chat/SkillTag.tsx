import { Box } from 'lucide-react'
import { forwardRef } from 'react'
import type { SkillSummary } from '../../../../preload/index.d'
import { ComposerInlineToken, ComposerInlineTokenLabel } from './ComposerInlineToken'
import { formatSkillDisplayTitle } from './skill-display'

export type SkillTagLike = Pick<SkillSummary, 'name'> &
  Partial<Pick<SkillSummary, 'filePath' | 'sourceLabel'>>

function sourceTitle(skill: SkillTagLike): string {
  return [skill.sourceLabel, skill.filePath].filter(Boolean).join('\n') || skill.name
}

export const SkillTag = forwardRef<
  HTMLButtonElement,
  { skill: SkillTagLike; onRemove?: () => void }
>(function SkillTag({ skill, onRemove }, ref) {
  const displayTitle = formatSkillDisplayTitle(skill.name)
  const content = (
    <>
      <Box className="size-3.5 self-center text-codex-blue-400" strokeWidth={1.8} aria-hidden />
      <ComposerInlineTokenLabel>{displayTitle}</ComposerInlineTokenLabel>
    </>
  )

  if (!onRemove) {
    return <ComposerInlineToken title={sourceTitle(skill)}>{content}</ComposerInlineToken>
  }

  return (
    <ComposerInlineToken ref={ref} onClick={onRemove} title={sourceTitle(skill)}>
      {content}
    </ComposerInlineToken>
  )
})
