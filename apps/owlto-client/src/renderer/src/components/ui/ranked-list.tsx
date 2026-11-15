import {
  type Announcements,
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  type ScreenReaderInstructions,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { cn } from '@renderer/lib/utils'
import type { ReactNode } from 'react'
import { CheckIcon, GripVerticalIcon } from './icons'

export type RankedItem = {
  id: string
  label: string
  /** Decorative mark before the label, such as an agent's logo. */
  icon?: ReactNode
  on: boolean
  /** Shown after the label in a quieter color, such as "Not connected". */
  note?: string
}

/** Text for screen readers; dnd-kit's own is English only. */
export type RankedListCopy = {
  /** Names the drag handle, e.g. "Reorder Opus". */
  reorder(label: string): string
  instructions: string
  picked(label: string): string
  moved(label: string, position: number): string
  dropped(label: string, position: number): string
  canceled(label: string): string
}

function RankedRow({
  item,
  copy,
  onToggle
}: {
  item: RankedItem
  copy: RankedListCopy
  onToggle(): void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: item.id })
  return (
    <li
      ref={setNodeRef}
      className={cn('owlto-ranked-row', isDragging && 'dragging')}
      // Rows only move up and down, so the sideways part of a drag is dropped.
      style={{
        transform: transform ? `translate3d(0, ${transform.y}px, 0)` : undefined,
        transition
      }}
    >
      <button
        type="button"
        aria-pressed={item.on}
        className="owlto-ranked-toggle"
        onClick={onToggle}
      >
        {item.icon}
        <span className="owlto-ranked-label">{item.label}</span>
        {item.on ? <CheckIcon size={15} className="owlto-ranked-check" /> : null}
        {item.note ? <small>{item.note}</small> : null}
      </button>
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="owlto-ranked-grip"
        aria-label={copy.reorder(item.label)}
        {...attributes}
        {...listeners}
      >
        <GripVerticalIcon size={15} />
      </button>
    </li>
  )
}

/**
 * A column of choices the user checks and drags into order, such as the models an agent
 * should try first. Every change hands back the whole list in its new order.
 */
export function RankedList({
  header,
  items,
  copy,
  onChange,
  className
}: {
  header?: ReactNode
  items: RankedItem[]
  copy: RankedListCopy
  onChange(items: RankedItem[]): void
  className?: string
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const label = (id: string | number) => items.find((i) => i.id === id)?.label ?? String(id)
  const position = (id: string | number) => items.findIndex((i) => i.id === id) + 1
  const announcements: Announcements = {
    onDragStart: ({ active }) => copy.picked(label(active.id)),
    onDragOver: ({ active, over }) =>
      over ? copy.moved(label(active.id), position(over.id)) : undefined,
    onDragEnd: ({ active, over }) =>
      over ? copy.dropped(label(active.id), position(over.id)) : copy.canceled(label(active.id)),
    onDragCancel: ({ active }) => copy.canceled(label(active.id))
  }
  const instructions: ScreenReaderInstructions = { draggable: copy.instructions }
  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    onChange(arrayMove(items, position(active.id) - 1, position(over.id) - 1))
  }
  return (
    <div className={cn('owlto-ranked-list', className)}>
      {header ? <div className="owlto-ranked-header">{header}</div> : null}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        accessibility={{ announcements, screenReaderInstructions: instructions }}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <ul>
            {items.map((item) => (
              <RankedRow
                key={item.id}
                item={item}
                copy={copy}
                onToggle={() =>
                  onChange(items.map((i) => (i.id === item.id ? { ...i, on: !i.on } : i)))
                }
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  )
}
