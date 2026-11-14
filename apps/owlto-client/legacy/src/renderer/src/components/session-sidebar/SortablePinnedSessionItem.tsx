import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@renderer/lib/utils'
import type { CSSProperties } from 'react'

export function SortablePinnedSessionItem({
  sessionId,
  children
}: {
  sessionId: string
  children: (state: { isDragging: boolean }) => React.ReactNode
}): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sessionId
  })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn('touch-none', isDragging && 'relative z-10')}
      {...attributes}
      {...listeners}
    >
      {children({ isDragging })}
    </div>
  )
}
