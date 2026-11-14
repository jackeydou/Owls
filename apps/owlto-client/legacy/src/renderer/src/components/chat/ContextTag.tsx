import { forwardRef } from 'react'
import {
  ComposerInlineToken,
  ComposerInlineTokenLabel,
  ComposerInlineTokenTextIcon
} from './ComposerInlineToken'
import type { ComposerContextTag, ParsedMessageContextTag } from './context-tags'

type DisplayTag = ComposerContextTag | ParsedMessageContextTag

function titleForTag(tag: DisplayTag): string {
  return [tag.id, tag.path].filter(Boolean).join('\n')
}

export const ContextTag = forwardRef<
  HTMLButtonElement,
  {
    tag: DisplayTag
    onRemove?: () => void
  }
>(function ContextTag({ tag, onRemove }, ref) {
  const content = (
    <>
      {'iconUrl' in tag && tag.iconUrl ? (
        <img src={tag.iconUrl} alt="" className="size-3.5 self-center rounded-sm object-cover" />
      ) : (
        <ComposerInlineTokenTextIcon>@</ComposerInlineTokenTextIcon>
      )}
      <ComposerInlineTokenLabel>{tag.name}</ComposerInlineTokenLabel>
    </>
  )

  if (!onRemove) {
    return <ComposerInlineToken title={titleForTag(tag)}>{content}</ComposerInlineToken>
  }

  return (
    <ComposerInlineToken
      ref={ref}
      onClick={() => {
        onRemove?.()
      }}
      title={titleForTag(tag)}
    >
      {content}
    </ComposerInlineToken>
  )
})
