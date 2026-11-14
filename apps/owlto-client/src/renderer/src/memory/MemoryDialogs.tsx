import { ActionButton } from '@renderer/components/ui/action-button'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { Select } from '@renderer/components/ui/select'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MemoryCategoryView, MemoryView } from '../../../shared/memory'
import { useMemoryStore } from './store'

export function DeleteMemoryDialog({
  memory,
  onClose
}: {
  memory: MemoryView
  onClose: () => void
}) {
  const { t } = useTranslation()
  const remove = useMemoryStore((s) => s.remove)
  const titleId = useId()
  return (
    <Dialog onClose={onClose} aria-labelledby={titleId} className="memory-dialog">
      <h2 id={titleId}>{t('memory.deleteTitle')}</h2>
      <p className="memory-dialog-quote">{memory.text}</p>
      <p>{t('memory.deleteBody')}</p>
      <footer>
        <Button size="sm" variant="ghost" onClick={onClose}>
          {t('memory.cancel')}
        </Button>
        <ActionButton
          size="sm"
          variant="destructive"
          onAction={async () => {
            await remove(memory)
            onClose()
          }}
        >
          {t('memory.delete')}
        </ActionButton>
      </footer>
    </Dialog>
  )
}

type Mode = 'rename' | 'merge' | 'delete'

/** Renames, merges, or deletes a personal category. Deleting asks where its memories go. */
export function CategoryDialog({
  category,
  others,
  onClose
}: {
  category: MemoryCategoryView
  others: MemoryCategoryView[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  const act = useMemoryStore((s) => s.category)
  const titleId = useId()
  const [mode, setMode] = useState<Mode>('rename')
  const [name, setName] = useState(category.name)
  const [description, setDescription] = useState(category.description)
  const [into, setInto] = useState(others[0]?.id ?? '')
  /** Where a deleted category's memories go; empty deletes them with it. */
  const [moveTo, setMoveTo] = useState(others[0]?.id ?? '')
  async function submit() {
    const base = { id: category.id, baseRev: category.rev }
    const ok =
      mode === 'rename'
        ? await act({
            action: 'rename',
            ...base,
            name: name.trim(),
            description: description.trim()
          })
        : mode === 'merge' || moveTo
          ? await act({ action: 'merge', ...base, into: mode === 'merge' ? into : moveTo })
          : await act({ action: 'remove', ...base })
    if (ok) onClose()
  }
  const valid = mode === 'rename' ? Boolean(name.trim()) : mode === 'merge' ? Boolean(into) : true
  return (
    <Dialog onClose={onClose} aria-labelledby={titleId} className="memory-dialog">
      <h2 id={titleId}>
        {mode === 'merge'
          ? t('memory.category.mergeTitle', { name: category.name })
          : mode === 'delete'
            ? t('memory.category.deleteTitle', { name: category.name })
            : t('memory.category.manage', { name: category.name })}
      </h2>
      <div
        className="memory-tabs"
        role="tablist"
        aria-label={t('memory.category.manage', { name: category.name })}
      >
        {(['rename', 'merge', 'delete'] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            variant="ghost"
            role="tab"
            aria-selected={mode === value}
            disabled={value === 'merge' && !others.length}
            onClick={() => setMode(value)}
          >
            {t(`memory.category.${value}`)}
          </Button>
        ))}
      </div>
      {mode === 'rename' ? (
        <div className="memory-dialog-fields">
          <input
            className="router-input"
            aria-label={t('memory.category.name')}
            maxLength={40}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <input
            className="router-input"
            aria-label={t('memory.category.description')}
            placeholder={t('memory.category.description')}
            maxLength={200}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          {category.createdBy === 'agent' ? (
            <p className="owlto-note">{t('memory.category.byAgent')}</p>
          ) : null}
        </div>
      ) : mode === 'merge' ? (
        <div className="memory-dialog-fields">
          <Select
            aria-label={t('memory.category.mergeInto')}
            value={into}
            onChange={(event) => setInto(event.target.value)}
          >
            {others.map((other) => (
              <option key={other.id} value={other.id}>
                {other.name}
              </option>
            ))}
          </Select>
        </div>
      ) : (
        <div className="memory-dialog-fields">
          <p>{t('memory.category.deleteBody', { count: category.count })}</p>
          <Select
            aria-label={t('memory.category.moveTo')}
            value={moveTo}
            onChange={(event) => setMoveTo(event.target.value)}
          >
            {others.map((other) => (
              <option key={other.id} value={other.id}>
                {t('memory.category.moveTo')} {other.name}
              </option>
            ))}
            <option value="">{t('memory.category.deleteAll')}</option>
          </Select>
        </div>
      )}
      <footer>
        <Button size="sm" variant="ghost" onClick={onClose}>
          {t('memory.cancel')}
        </Button>
        <ActionButton
          size="sm"
          variant={mode === 'delete' && !moveTo ? 'destructive' : 'default'}
          disabled={!valid}
          onAction={submit}
        >
          {mode === 'delete' ? t('memory.delete') : t('memory.save')}
        </ActionButton>
      </footer>
    </Dialog>
  )
}
