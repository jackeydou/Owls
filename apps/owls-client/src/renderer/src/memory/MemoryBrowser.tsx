import { Button } from '@renderer/components/ui/button'
import { IconButton } from '@renderer/components/ui/icon-button'
import { EllipsisIcon, PlusIcon } from '@renderer/components/ui/icons'
import { Select } from '@renderer/components/ui/select'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MemoryCategoryView } from '../../../shared/memory'
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
      <div className="memory-tabs" role="tablist" aria-label={t('memory.storesLabel')}>
        {(['personal', 'project'] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            variant="ghost"
            role="tab"
            aria-selected={store === value}
            onClick={() =>
              setFilter({
                store: value,
                categoryId: null,
                kind: null,
                projectId: value === 'project' ? (projectId ?? projects[0]?.id ?? null) : projectId
              })
            }
          >
            {t(`memory.store.${value}`)}
          </Button>
        ))}
      </div>
      {store === 'project' && projects.length ? (
        <Select
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
    </div>
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
    <input
      type="search"
      className="router-input memory-search"
      aria-label={t('memory.search')}
      placeholder={t('memory.search')}
      maxLength={200}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
    />
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
      <div className="owls-settings-actions">
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

function CategoryNav() {
  const { t } = useTranslation()
  const overview = useMemoryStore((s) => s.overview)
  const categoryId = useMemoryStore((s) => s.categoryId)
  const setFilter = useMemoryStore((s) => s.setFilter)
  const [adding, setAdding] = useState(false)
  const [managing, setManaging] = useState<MemoryCategoryView | null>(null)
  const categories = overview?.categories ?? []
  const total = categories.reduce((sum, c) => sum + c.count, 0)
  return (
    <nav className="memory-nav" aria-label={t('memory.categories')}>
      <button
        type="button"
        aria-current={categoryId === null || undefined}
        onClick={() => setFilter({ categoryId: null })}
      >
        <span>{t('memory.all')}</span>
        <small>{total}</small>
      </button>
      {categories.map((category) => (
        <div className="memory-nav-row" key={category.id}>
          <button
            type="button"
            aria-current={categoryId === category.id || undefined}
            onClick={() => setFilter({ categoryId: category.id })}
          >
            <span>{category.name}</span>
            <small>{category.count}</small>
          </button>
          <IconButton
            size="custom"
            className="memory-nav-more"
            icon={<EllipsisIcon size={13} />}
            label={t('memory.category.manage', { name: category.name })}
            tooltip={t('memory.category.manage', { name: category.name })}
            onClick={() => setManaging(category)}
          />
        </div>
      ))}
      {adding ? (
        <NewCategory onDone={() => setAdding(false)} />
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="memory-nav-add"
          onClick={() => setAdding(true)}
        >
          <PlusIcon size={13} aria-hidden />
          {t('memory.category.add')}
        </Button>
      )}
      {managing ? (
        <CategoryDialog
          category={managing}
          others={categories.filter((c) => c.id !== managing.id)}
          onClose={() => setManaging(null)}
        />
      ) : null}
    </nav>
  )
}

function KindNav() {
  const { t } = useTranslation()
  const overview = useMemoryStore((s) => s.overview)
  const projectId = useMemoryStore((s) => s.projectId)
  const kind = useMemoryStore((s) => s.kind)
  const setFilter = useMemoryStore((s) => s.setFilter)
  const counts = overview?.projects.find((p) => p.projectId === projectId)?.counts
  const total = counts ? Object.values(counts).reduce((sum, n) => sum + n, 0) : 0
  return (
    <nav className="memory-nav" aria-label={t('memory.kinds')}>
      <button
        type="button"
        aria-current={kind === null || undefined}
        onClick={() => setFilter({ kind: null })}
      >
        <span>{t('memory.all')}</span>
        <small>{total}</small>
      </button>
      {projectMemoryKindSchema.options.map((value) => (
        <button
          type="button"
          key={value}
          aria-current={kind === value || undefined}
          onClick={() => setFilter({ kind: value })}
        >
          <span>
            {t(`memory.kind.${value}`)}
            <em>{t(`memory.kindHelp.${value}`)}</em>
          </span>
          <small>{counts?.[value] ?? 0}</small>
        </button>
      ))}
    </nav>
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
  if (store === 'project' && !projectId)
    return <p className="memory-empty">{t('memory.noProjects')}</p>
  return (
    <div className="memory-list">
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
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="memory-add"
          disabled={!canAdd}
          onClick={() => setAdding(true)}
        >
          <PlusIcon size={13} aria-hidden />
          {t('memory.add')}
        </Button>
      )}
      {status === 'loading' ? (
        <p className="memory-empty">{t('memory.loading')}</p>
      ) : status === 'failed' ? (
        <p className="memory-empty">{t('memory.error.generic')}</p>
      ) : items.length ? (
        <ul>
          {items.map((memory) => (
            <MemoryRow key={memory.id} memory={memory} categories={categories} />
          ))}
        </ul>
      ) : (
        <p className="memory-empty">{query ? t('memory.noMatch') : t('memory.empty')}</p>
      )}
    </div>
  )
}

export function MemoryBrowser() {
  const { t } = useTranslation()
  const store = useMemoryStore((s) => s.store)
  const archived = useMemoryStore((s) => s.archived)
  const setFilter = useMemoryStore((s) => s.setFilter)
  return (
    <div className="memory-browser">
      <StoreTabs />
      <div className="memory-columns">
        {store === 'personal' ? <CategoryNav /> : <KindNav />}
        <MemoryList />
      </div>
      <label className="memory-archived">
        <input
          type="checkbox"
          checked={archived}
          onChange={(event) => setFilter({ archived: event.target.checked })}
        />
        {t('memory.showArchived')}
      </label>
    </div>
  )
}
