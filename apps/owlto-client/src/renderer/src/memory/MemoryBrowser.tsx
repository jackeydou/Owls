import { Button } from '@renderer/components/ui/button'
import {
  AlertCircleIcon,
  BrainIcon,
  CheckIcon,
  DownloadIcon,
  FileCodeIcon,
  FolderIcon,
  PencilIcon,
  PlusIcon,
  ScrollTextIcon,
  SearchIcon,
  UserIcon
} from '@renderer/components/ui/icons'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@renderer/components/ui/menu'
import { Select } from '@renderer/components/ui/select'
import { useAction } from '@renderer/components/ui/use-action'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MemoryCategoryView, MemoryExportFormat } from '../../../shared/memory'
import { MEMORY_TEXT_LIMIT, projectMemoryKindSchema } from '../../../shared/memory'
import { useAppStore } from '../app/store'
import { CategoryDialog } from './MemoryDialogs'
import { MemoryEditor, MemoryRow } from './MemoryRow'
import { newRecordId, useMemoryStore } from './store'

function StoreTabs() {
  const { t } = useTranslation()
  const store = useMemoryStore((s) => s.store)
  const projectId = useMemoryStore((s) => s.projectId)
  const setFilter = useMemoryStore((s) => s.setFilter)
  const projects = useAppStore((s) => s.projects)
  return (
    <div className="memory-toolbar">
      <fieldset className="owlto-segmented memory-stores" aria-label={t('memory.storesLabel')}>
        {(['personal', 'project'] as const).map((value) => (
          <button
            type="button"
            key={value}
            aria-pressed={store === value}
            onClick={() =>
              setFilter({
                store: value,
                categoryId: null,
                kind: null,
                projectId: value === 'project' ? (projectId ?? projects[0]?.id ?? null) : projectId
              })
            }
          >
            {value === 'personal' ? (
              <UserIcon size={14} aria-hidden />
            ) : (
              <FolderIcon size={14} aria-hidden />
            )}
            {t(`memory.store.${value}`)}
          </button>
        ))}
      </fieldset>
      {store === 'project' && projects.length ? (
        <Select
          className="memory-project"
          aria-label={t('memory.project')}
          value={projectId ?? ''}
          onChange={(event) => setFilter({ projectId: event.target.value || null, kind: null })}
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </Select>
      ) : null}
      <SearchBox />
      <ExportMenu />
    </div>
  )
}

/** One export button; the format is picked from its menu, and the button shows how it went. */
function ExportMenu() {
  const { t } = useTranslation()
  const exportAs = useMemoryStore((s) => s.exportAs)
  const format = useRef<MemoryExportFormat>('markdown')
  const { phase, run } = useAction(async () =>
    (await exportAs(format.current)) ? 'done' : 'quiet'
  )
  const pick = (next: MemoryExportFormat) => {
    format.current = next
    void run()
  }
  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button size="sm" variant="outline" className="font-medium" pending={phase === 'pending'}>
            {phase === 'done' ? (
              <CheckIcon size={15} aria-hidden />
            ) : phase === 'failed' ? (
              <AlertCircleIcon size={15} aria-hidden />
            ) : (
              <DownloadIcon size={15} aria-hidden />
            )}
            {phase === 'done'
              ? t('memory.export.done')
              : phase === 'failed'
                ? t('action.failed')
                : t('memory.export')}
          </Button>
        </MenuTrigger>
        <MenuContent align="end" className="min-w-[180px]">
          <MenuItem onSelect={() => pick('markdown')}>
            <ScrollTextIcon size={15} aria-hidden />
            {t('memory.export.markdown')}
          </MenuItem>
          <MenuItem onSelect={() => pick('json')}>
            <FileCodeIcon size={15} aria-hidden />
            {t('memory.export.json')}
          </MenuItem>
        </MenuContent>
      </Menu>
      <span className="sr-only" role="status">
        {phase === 'done' ? t('memory.export.done') : phase === 'failed' ? t('action.failed') : ''}
      </span>
    </>
  )
}

/** Filters as the user types, after a short pause so each key does not reload the list. */
function SearchBox() {
  const { t } = useTranslation()
  const query = useMemoryStore((s) => s.query)
  const setFilter = useMemoryStore((s) => s.setFilter)
  const [draft, setDraft] = useState(query)
  useEffect(() => {
    if (draft === query) return
    const timer = setTimeout(() => setFilter({ query: draft }), 200)
    return () => clearTimeout(timer)
  }, [draft, query, setFilter])
  return (
    <label className="memory-search">
      <SearchIcon size={14} aria-hidden />
      <input
        type="search"
        aria-label={t('memory.search')}
        placeholder={t('memory.search')}
        maxLength={200}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    </label>
  )
}

function NewCategory({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation()
  const category = useMemoryStore((s) => s.category)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  async function submit() {
    const ok = await category({
      action: 'add',
      id: newRecordId('mc'),
      name: name.trim(),
      description: description.trim()
    })
    if (ok) onDone()
  }
  return (
    <form
      className="memory-category-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (name.trim()) void submit()
      }}
    >
      <input
        className="router-input"
        aria-label={t('memory.category.name')}
        placeholder={t('memory.category.name')}
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
      <div className="owlto-settings-actions">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {t('memory.cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={!name.trim()}>
          {t('memory.save')}
        </Button>
      </div>
    </form>
  )
}

function Chip({
  label,
  count,
  pressed,
  onClick
}: {
  label: string
  count: number
  pressed: boolean
  onClick: () => void
}) {
  return (
    <button type="button" className="memory-chip" aria-pressed={pressed} onClick={onClick}>
      {label}
      <small>{count}</small>
    </button>
  )
}

/** Personal categories as filter chips; the open category's description and settings sit below. */
function CategoryChips() {
  const { t } = useTranslation()
  const overview = useMemoryStore((s) => s.overview)
  const categoryId = useMemoryStore((s) => s.categoryId)
  const setFilter = useMemoryStore((s) => s.setFilter)
  const [adding, setAdding] = useState(false)
  const [managing, setManaging] = useState<MemoryCategoryView | null>(null)
  const categories = overview?.categories ?? []
  const total = categories.reduce((sum, c) => sum + c.count, 0)
  const current = categories.find((c) => c.id === categoryId) ?? null
  return (
    <>
      <fieldset className="memory-chips" aria-label={t('memory.categories')}>
        <Chip
          label={t('memory.all')}
          count={total}
          pressed={categoryId === null}
          onClick={() => setFilter({ categoryId: null })}
        />
        {categories.map((category) => (
          <Chip
            key={category.id}
            label={category.name}
            count={category.count}
            pressed={categoryId === category.id}
            onClick={() => setFilter({ categoryId: category.id })}
          />
        ))}
        <button
          type="button"
          className="memory-chip add"
          aria-expanded={adding}
          onClick={() => setAdding(!adding)}
        >
          <PlusIcon size={13} aria-hidden />
          {t('memory.category.add')}
        </button>
      </fieldset>
      {adding ? <NewCategory onDone={() => setAdding(false)} /> : null}
      {current ? (
        <div className="memory-filter-note">
          {current.description ? <p>{current.description}</p> : <span />}
          <Button size="sm" variant="ghost" onClick={() => setManaging(current)}>
            <PencilIcon size={14} aria-hidden />
            {t('memory.category.edit')}
          </Button>
        </div>
      ) : null}
      {managing ? (
        <CategoryDialog
          category={managing}
          others={categories.filter((c) => c.id !== managing.id)}
          onClose={() => setManaging(null)}
        />
      ) : null}
    </>
  )
}

/** Project memory kinds as filter chips, with the open kind's meaning below. */
function KindChips() {
  const { t } = useTranslation()
  const overview = useMemoryStore((s) => s.overview)
  const projectId = useMemoryStore((s) => s.projectId)
  const kind = useMemoryStore((s) => s.kind)
  const setFilter = useMemoryStore((s) => s.setFilter)
  const counts = overview?.projects.find((p) => p.projectId === projectId)?.counts
  const total = counts ? Object.values(counts).reduce((sum, n) => sum + n, 0) : 0
  return (
    <>
      <fieldset className="memory-chips" aria-label={t('memory.kinds')}>
        <Chip
          label={t('memory.all')}
          count={total}
          pressed={kind === null}
          onClick={() => setFilter({ kind: null })}
        />
        {projectMemoryKindSchema.options.map((value) => (
          <Chip
            key={value}
            label={t(`memory.kind.${value}`)}
            count={counts?.[value] ?? 0}
            pressed={kind === value}
            onClick={() => setFilter({ kind: value })}
          />
        ))}
      </fieldset>
      {kind ? (
        <div className="memory-filter-note">
          <p>{t(`memory.kindHelp.${kind}`)}</p>
        </div>
      ) : null}
    </>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div className="memory-empty">
      <BrainIcon size={20} aria-hidden />
      <p>{text}</p>
    </div>
  )
}

function MemoryList() {
  const { t } = useTranslation()
  const status = useMemoryStore((s) => s.status)
  const items = useMemoryStore((s) => s.items)
  const query = useMemoryStore((s) => s.query)
  const store = useMemoryStore((s) => s.store)
  const projectId = useMemoryStore((s) => s.projectId)
  const categoryId = useMemoryStore((s) => s.categoryId)
  const kind = useMemoryStore((s) => s.kind)
  const overview = useMemoryStore((s) => s.overview)
  const save = useMemoryStore((s) => s.save)
  const [adding, setAdding] = useState(false)
  const categories = overview?.categories ?? []
  const canAdd = store === 'personal' ? categories.length > 0 : Boolean(projectId)
  const archived = useMemoryStore((s) => s.archived)
  const setFilter = useMemoryStore((s) => s.setFilter)
  if (store === 'project' && !projectId)
    return (
      <div className="memory-card">
        <Empty text={t('memory.noProjects')} />
      </div>
    )
  return (
    <div className="memory-card">
      <header className="memory-card-head">
        <span>{t('memory.count', { count: items.length })}</span>
        <label className="memory-archived">
          <input
            type="checkbox"
            checked={archived}
            onChange={(event) => setFilter({ archived: event.target.checked })}
          />
          {t('memory.showArchived')}
        </label>
        <Button
          size="sm"
          variant="ghost"
          disabled={!canAdd || adding}
          onClick={() => setAdding(true)}
        >
          <PlusIcon size={15} aria-hidden />
          {t('memory.add')}
        </Button>
      </header>
      {adding ? (
        <MemoryEditor
          store={store}
          text=""
          categoryId={categoryId ?? categories[0]?.id ?? null}
          kind={kind ?? 'knowledge'}
          categories={categories}
          onCancel={() => setAdding(false)}
          onSave={async (draft) => {
            const ok = await save({
              action: 'add',
              id: newRecordId('m'),
              text: draft.text.slice(0, MEMORY_TEXT_LIMIT),
              scope:
                store === 'personal'
                  ? { store, categoryId: draft.categoryId ?? '' }
                  : { store, projectId: projectId ?? '', kind: draft.kind }
            })
            if (ok) setAdding(false)
          }}
        />
      ) : null}
      {status === 'loading' ? (
        <Empty text={t('memory.loading')} />
      ) : status === 'failed' ? (
        <Empty text={t('memory.error.generic')} />
      ) : items.length ? (
        <ul>
          {items.map((memory) => (
            <MemoryRow key={memory.id} memory={memory} categories={categories} />
          ))}
        </ul>
      ) : (
        <Empty text={query ? t('memory.noMatch') : t('memory.empty')} />
      )}
    </div>
  )
}

export function MemoryBrowser() {
  const store = useMemoryStore((s) => s.store)
  return (
    <div className="memory-browser">
      <StoreTabs />
      {store === 'personal' ? <CategoryChips /> : <KindChips />}
      <MemoryList />
    </div>
  )
}
