import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AppHotkeyBadge } from '@renderer/components/AppHotkeyBadge'
import { IconButton } from '@renderer/components/ui/icon-button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useI18n } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { CornerDownRight, Ellipsis, GripVertical, ListEnd, Pencil, Trash2 } from 'lucide-react'
import type { CSSProperties } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../ui/dropdown-menu'
import type { ComposerQueuedPrompt } from './chat-composer-types'
import { queuedPromptPreview } from './chat-composer-utils'

function SortableQueuedPromptItem({
  confirmRemove,
  followUpBehavior,
  onConfirmRemove,
  onEdit,
  onFollowUpBehaviorChange,
  onRequestRemove,
  onSteer,
  prompt
}: {
  confirmRemove: boolean
  followUpBehavior: 'queue' | 'steer'
  onConfirmRemove: (id: string) => void
  onEdit: (prompt: ComposerQueuedPrompt) => void
  onFollowUpBehaviorChange: (behavior: 'queue' | 'steer') => Promise<void>
  onRequestRemove: (id: string) => void
  onSteer: (id: string) => void
  prompt: ComposerQueuedPrompt
}): React.JSX.Element {
  const { t } = useI18n()
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition
  } = useSortable({ id: prompt.id })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition
  }
  const preview = queuedPromptPreview(prompt)
  const queueingEnabled = followUpBehavior === 'queue'

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group/queued flex h-9 touch-none items-center gap-1.5 px-3',
        isDragging && 'relative z-10 opacity-45'
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className="-ml-0.5 flex shrink-0 cursor-grab items-center text-muted-foreground/55 transition hover:text-muted-foreground active:cursor-grabbing"
        aria-label={t('chat.reorderQueuedMessage')}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3.5" strokeWidth={1.8} aria-hidden />
        <CornerDownRight className="-ml-1 size-3.5" strokeWidth={1.8} aria-hidden />
      </button>
      <div className="min-w-0 flex-1 truncate text-[13px] leading-4 text-foreground/85">
        {preview || t('chat.queueMessage')}
      </div>
      <Tooltip>
        <TooltipTrigger
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[13px] font-medium text-muted-foreground transition hover:bg-card-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onSteer(prompt.id)}
        >
          <CornerDownRight className="size-3.5" strokeWidth={1.8} aria-hidden />
          {t('chat.steer')}
        </TooltipTrigger>
        <TooltipContent
          side="top"
          sideOffset={5}
          className="flex items-center gap-1.5 rounded-[14px] border-border/55 bg-card px-2.5 py-1.5 text-[14px] leading-5 shadow-[0_2px_10px_rgb(0_0_0_/_0.06)]"
        >
          <span className="font-normal text-foreground">{t('chat.steer')}</span>
          <AppHotkeyBadge
            shortcut="⌘Enter"
            className="flex items-center gap-0.5 rounded-full bg-card-muted px-2 py-0.5 text-[13px] font-medium leading-4 text-foreground/85 shadow-[inset_0_0_0_1px_rgb(0_0_0_/_0.04)] dark:shadow-[inset_0_0_0_1px_rgb(255_255_255_/_0.08)]"
          />
        </TooltipContent>
      </Tooltip>
      <div className="flex h-7 shrink-0 items-center justify-end">
        {confirmRemove ? (
          <button
            type="button"
            className="rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-medium leading-5 text-red-600 transition hover:bg-red-500/15 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-red-500/15 dark:text-red-300 dark:hover:bg-red-500/20 dark:hover:text-red-200"
            onClick={() => onConfirmRemove(prompt.id)}
            aria-label={t('chat.confirmRemoveQueuedMessage')}
          >
            {t('chat.confirmRemoveQueuedMessage')}
          </button>
        ) : (
          <IconButton
            label={t('chat.removeQueuedMessage')}
            icon={<Trash2 className="size-3.5" strokeWidth={1.8} aria-hidden />}
            variant="unstyled"
            size="custom"
            className="size-7 text-muted-foreground transition hover:bg-card-muted/70 hover:text-foreground focus-visible:ring-ring"
            onClick={() => onRequestRemove(prompt.id)}
          />
        )}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            label={t('chat.queuedMessageActions')}
            icon={<Ellipsis className="size-3.5" strokeWidth={1.8} aria-hidden />}
            variant="unstyled"
            size="custom"
            className="-mr-0.5 size-7 shrink-0 text-muted-foreground transition hover:bg-card-muted/70 hover:text-foreground focus-visible:ring-ring"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" sideOffset={8} className="w-44">
          <DropdownMenuItem onSelect={() => onEdit(prompt)}>
            <Pencil className="size-4 text-muted-foreground" strokeWidth={1.8} />
            {t('chat.editQueuedMessage')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => void onFollowUpBehaviorChange(queueingEnabled ? 'steer' : 'queue')}
          >
            <ListEnd className="size-4 text-muted-foreground" strokeWidth={1.8} />
            {queueingEnabled ? t('chat.turnOffQueueing') : t('chat.turnOnQueueing')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function ComposerQueuedPrompts({
  confirmRemovePromptId,
  followUpBehavior,
  onConfirmRemove,
  onEdit,
  onFollowUpBehaviorChange,
  onRemoveConfirmState,
  onReorder,
  onRequestRemove,
  onSteer,
  prompts
}: {
  confirmRemovePromptId: string | null
  followUpBehavior: 'queue' | 'steer'
  onConfirmRemove: (id: string) => void
  onEdit: (prompt: ComposerQueuedPrompt) => void
  onFollowUpBehaviorChange: (behavior: 'queue' | 'steer') => Promise<void>
  onRemoveConfirmState: () => void
  onReorder?: (ids: string[]) => void
  onRequestRemove: (id: string) => void
  onSteer: (id: string) => void
  prompts: ComposerQueuedPrompt[]
}): React.JSX.Element {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6
      }
    })
  )

  const finishSort = (event: DragEndEvent): void => {
    const activePromptId = String(event.active.id)
    const overPromptId = event.over ? String(event.over.id) : null
    if (!overPromptId || activePromptId === overPromptId) return

    const currentPromptIds = prompts.map((prompt) => prompt.id)
    const activeIndex = currentPromptIds.indexOf(activePromptId)
    const overIndex = currentPromptIds.indexOf(overPromptId)
    if (activeIndex === -1 || overIndex === -1) return

    onReorder?.(arrayMove(currentPromptIds, activeIndex, overIndex))
    onRemoveConfirmState()
  }

  return (
    <div className="relative z-0 mx-7 mb-[-1px] divide-y divide-border/60 overflow-hidden rounded-t-[24px] border border-b-0 border-border/70 bg-card/80 shadow-sm sm:mx-10">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={finishSort}>
        <SortableContext
          items={prompts.map((prompt) => prompt.id)}
          strategy={verticalListSortingStrategy}
        >
          {prompts.map((prompt) => (
            <SortableQueuedPromptItem
              key={prompt.id}
              prompt={prompt}
              confirmRemove={confirmRemovePromptId === prompt.id}
              onEdit={onEdit}
              onRequestRemove={onRequestRemove}
              onConfirmRemove={onConfirmRemove}
              onSteer={onSteer}
              followUpBehavior={followUpBehavior}
              onFollowUpBehaviorChange={onFollowUpBehaviorChange}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  )
}
