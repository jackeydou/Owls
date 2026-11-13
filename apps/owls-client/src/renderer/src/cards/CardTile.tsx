import { CheckIcon } from '@renderer/components/ui/icons'
import { useTranslation } from 'react-i18next'
import type { Card } from '../../../shared/cards'
import { useAppStore } from '../app/store'

const EXCERPT = 180

/** A card's body as one plain line: Markdown marks and code fences stripped. */
export function excerpt(body: string, limit = EXCERPT): string {
  const plain = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/(\*\*|__|~~|[*`])/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > limit ? `${plain.slice(0, limit)}…` : plain
}

/** Where a card came from, in a few words. */
export function useSourceLabel(card: Card): string {
  const { t } = useTranslation()
  if (!card.source) return t('cards.sourceManual')
  const title = card.source.threadTitle ?? t('thread.untitled')
  return t(card.source.kind === 'worker' ? 'cards.sourceWorker' : 'cards.sourceMessage', { title })
}

/** One card in the list: click opens it, the check picks it for sending. */
export function CardTile({
  card,
  selected,
  open,
  onToggle,
  onOpen
}: {
  card: Card
  selected: boolean
  open: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  const { t } = useTranslation()
  const project = useAppStore((s) => s.projects.find((p) => p.id === card.projectId))
  const source = useSourceLabel(card)
  return (
    <article
      className="card-tile"
      aria-current={open || undefined}
      data-selected={selected || undefined}
    >
      <button type="button" className="card-tile-open" onClick={onOpen}>
        <h4>{card.title}</h4>
        {card.body ? <p>{excerpt(card.body)}</p> : null}
        {card.tags.length ? (
          <div className="card-tags">
            {card.tags.map((tag) => (
              <span key={tag}>#{tag}</span>
            ))}
          </div>
        ) : null}
        <small>
          {project ? `${project.name} · ` : ''}
          {source}
        </small>
      </button>
      <button
        type="button"
        aria-pressed={selected}
        className="card-tile-check"
        aria-label={t('cards.pick', { title: card.title })}
        onClick={onToggle}
      >
        {selected ? <CheckIcon size={12} /> : null}
      </button>
    </article>
  )
}
