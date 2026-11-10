import { Button } from '@renderer/components/ui/button'
import { IconButton } from '@renderer/components/ui/icon-button'
import { PencilIcon, PinIcon, PinOffIcon, TrashIcon } from '@renderer/components/ui/icons'
import { Select } from '@renderer/components/ui/select'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  MemoryCategoryView,
  MemoryStore,
  MemoryView,
  ProjectMemoryKind
} from '../../../shared/memory'
import { MEMORY_TEXT_LIMIT, projectMemoryKindSchema } from '../../../shared/memory'
import { useCodexStore } from '../codex/store'
import { DeleteMemoryDialog } from './MemoryDialogs'
import { useMemoryStore } from './store'

const day = (iso: string) => new Date(iso).toLocaleDateString()

type Draft = { text: string; categoryId: string | null; kind: ProjectMemoryKind }

/** Edits a memory's text and its category or kind in place. */
export function MemoryEditor({
  store,
  text,
  categoryId,
  kind,
  categories,
  onSave,
  onCancel
}: Draft & {
  store: MemoryStore
  categories: MemoryCategoryView[]
  onSave: (draft: Draft) => Promise<void>
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<Draft>({ text, categoryId, kind })
  const [saving, setSaving] = useState(false)
  const valid = draft.text.trim() && (store === 'project' || draft.categoryId)
  return (
    <form
      className="memory-editor"
      onSubmit={async (event) => {
        event.preventDefault()
        if (!valid) return
        setSaving(true)
        await onSave({ ...draft, text: draft.text.trim() })
        setSaving(false)
      }}
    >
      <textarea
        aria-label={t('memory.textLabel')}
        placeholder={t('memory.textPlaceholder')}
        rows={2}
        maxLength={MEMORY_TEXT_LIMIT}
        value={draft.text}
        onChange={(event) => setDraft({ ...draft, text: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onCancel()
          }
        }}
      />
      <div className="memory-editor-bar">
        {store === 'personal' ? (
          <Select
            aria-label={t('memory.categoryLabel')}
            value={draft.categoryId ?? ''}
            onChange={(event) => setDraft({ ...draft, categoryId: event.target.value || null })}
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        ) : (
          <Select
            aria-label={t('memory.kindLabel')}
            value={draft.kind}
            onChange={(event) =>
              setDraft({ ...draft, kind: projectMemoryKindSchema.parse(event.target.value) })
            }
          >
            {projectMemoryKindSchema.options.map((value) => (
              <option key={value} value={value}>
                {t(`memory.kind.${value}`)}
              </option>
            ))}
          </Select>
        )}
        <div className="codex-settings-actions">
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            {t('memory.cancel')}
          </Button>
          <Button type="submit" size="sm" disabled={!valid || saving}>
            {t('memory.save')}
          </Button>
        </div>
      </div>
    </form>
  )
}

export function MemoryRow({
  memory,
  categories
}: {
  memory: MemoryView
  categories: MemoryCategoryView[]
}) {
  const { t } = useTranslation()
  const save = useMemoryStore((s) => s.save)
  const showThread = useCodexStore((s) => s.showThread)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  if (editing)
    return (
      <li className="memory-row editing">
        <MemoryEditor
          store={memory.store}
          text={memory.text}
          categoryId={memory.categoryId}
          kind={memory.kind ?? 'knowledge'}
          categories={categories}
          onCancel={() => setEditing(false)}
          onSave={async (draft) => {
            const ok = await save({
              action: 'update',
              id: memory.id,
              baseRev: memory.rev,
              ...(draft.text !== memory.text ? { text: draft.text } : {}),
              ...(memory.store === 'personal' && draft.categoryId !== memory.categoryId
                ? { categoryId: draft.categoryId ?? undefined }
                : {}),
              ...(memory.store === 'project' && draft.kind !== memory.kind
                ? { kind: draft.kind }
                : {})
            })
            if (ok) setEditing(false)
          }}
        />
      </li>
    )
  const label =
    memory.store === 'personal'
      ? (categories.find((c) => c.id === memory.categoryId)?.name ?? '')
      : t(`memory.kind.${memory.kind}`)
  const threadId = memory.source.threadId
  return (
    <li className={memory.status === 'archived' ? 'memory-row archived' : 'memory-row'}>
      <div className="memory-row-text">
        <p>
          {memory.pinned ? (
            <PinIcon size={12} className="memory-pin" aria-label={t('memory.pinnedLabel')} />
          ) : null}
          {memory.text}
        </p>
        <div className="memory-meta">
          {label ? <span>{label}</span> : null}
          <span>{day(memory.updatedAt)}</span>
          {threadId ? (
            <button type="button" className="memory-source" onClick={() => showThread(threadId)}>
              {memory.sourceTitle
                ? t('memory.from', { title: memory.sourceTitle })
                : t('memory.fromUntitled')}
            </button>
          ) : memory.origin === 'user' ? (
            <span>{t('memory.byYou')}</span>
          ) : null}
          {memory.editedByUser && memory.origin === 'dreaming' ? (
            <span>{t('memory.edited')}</span>
          ) : null}
          {memory.status === 'archived' ? <span>{t('memory.archived')}</span> : null}
          {memory.expiresAt ? (
            <span>{t('memory.expires', { date: day(memory.expiresAt) })}</span>
          ) : null}
        </div>
      </div>
      {memory.status === 'active' ? (
        <div className="memory-row-actions">
          <IconButton
            size="custom"
            icon={memory.pinned ? <PinOffIcon size={13} /> : <PinIcon size={13} />}
            label={memory.pinned ? t('memory.unpin') : t('memory.pin')}
            tooltip={memory.pinned ? t('memory.unpin') : t('memory.pin')}
            onClick={() =>
              void save({
                action: 'pin',
                id: memory.id,
                baseRev: memory.rev,
                pinned: !memory.pinned
              })
            }
          />
          <IconButton
            size="custom"
            icon={<PencilIcon size={13} />}
            label={t('memory.edit')}
            tooltip={t('memory.edit')}
            onClick={() => setEditing(true)}
          />
          <IconButton
            size="custom"
            icon={<TrashIcon size={13} />}
            label={t('memory.delete')}
            tooltip={t('memory.delete')}
            onClick={() => setDeleting(true)}
          />
        </div>
      ) : null}
      {deleting ? <DeleteMemoryDialog memory={memory} onClose={() => setDeleting(false)} /> : null}
    </li>
  )
}
