import { Button } from '@renderer/components/ui/button'
import { SearchIcon, UploadIcon } from '@renderer/components/ui/icons'
import { AnchoredPopover } from '@renderer/components/ui/popover'
import { cn } from '@renderer/lib/utils'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Project } from '../../../shared/app'
import {
  PROJECT_COLORS,
  PROJECT_ICON_IMAGE_LIMIT,
  type ProjectIcon as ProjectIconValue,
  type ProjectSettings
} from '../../../shared/projects'
import { projectHue } from '../router/activity'
import { ProjectIcon } from '../router/ProjectIcon'
import { ImageCropper } from './ImageCropper'
import { PROJECT_EMOJI } from './project-emoji'
import { SettingRow } from './SettingRow'
import { centeredSquare, type SquareCrop, squareImage } from './square-image'

/** Side of the square an image icon is stored at: sharp at 2x in a 20px tile, and small. */
const ICON_SIZE = 96
const COLORS = Array.from({ length: PROJECT_COLORS }, (_, index) => index + 1)
const TABS = ['emoji', 'upload'] as const
type Tab = (typeof TABS)[number]

function tabFor(icon: ProjectIconValue): Tab {
  return icon.kind === 'image' ? 'upload' : 'emoji'
}

/** Each search term starts one of the words; Chinese terms may sit anywhere in a word. */
function matches(words: string, query: string): boolean {
  const list = words.toLowerCase().split(' ')
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) =>
      list.some((word) => (/^[a-z0-9]+$/.test(term) ? word.startsWith(term) : word.includes(term)))
    )
}

/** The emoji tab: the offered emoji by group, or the matches for a search. */
function EmojiGrid({
  query,
  current,
  onPick
}: {
  query: string
  current: string | null
  onPick: (value: string) => void
}) {
  const { t } = useTranslation()
  const typed = query.trim()
  // A search shows its matches as one grid, without group headings.
  const groups = useMemo(() => {
    if (!typed) return PROJECT_EMOJI
    const emoji = PROJECT_EMOJI.flatMap((group) => group.emoji).filter(
      ([value, words]) => value === typed || matches(words, typed)
    )
    return emoji.length ? [{ group: null, emoji }] : []
  }, [typed])
  const button = (value: string, label?: string) => (
    <button
      type="button"
      key={value}
      className="emoji"
      aria-label={label}
      aria-pressed={current === value}
      onClick={() => onPick(value)}
    >
      {value}
    </button>
  )
  if (groups.length === 0) {
    // A search that matches nothing may be the emoji or short text itself.
    if (typed && [...typed].length <= 4)
      return <div className="owlto-icon-picker-grid">{button(typed)}</div>
    return <p className="owlto-icon-picker-empty">{t('projectSettings.icon.noMatch')}</p>
  }
  return groups.map(({ group, emoji }) => (
    <section key={group ?? 'matches'} className="owlto-icon-picker-group">
      {group ? <h4>{t(`projectSettings.icon.group.${group}`)}</h4> : null}
      <div className="owlto-icon-picker-grid">
        {emoji.map(([value, words]) => button(value, words.split(' ')[0]))}
      </div>
    </section>
  ))
}

/** The upload tab: pick or drop an image. */
function UploadPane({ onFile, failed }: { onFile: (file: File) => void; failed: boolean }) {
  const { t } = useTranslation()
  const fileInput = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a drop target only; the Choose image button is the keyboard and pointer path.
    <div
      className={cn('owlto-icon-picker-upload', over && 'over')}
      onDragOver={(event) => {
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault()
        setOver(false)
        const file = event.dataTransfer.files[0]
        if (file) onFile(file)
      }}
    >
      <UploadIcon size={22} />
      <p>{t('projectSettings.icon.uploadHelp')}</p>
      <Button size="sm" variant="outline" data-autofocus onClick={() => fileInput.current?.click()}>
        {t('projectSettings.icon.choose')}
      </Button>
      {failed ? (
        <p className="owlto-project-icon-error" role="alert">
          {t('projectSettings.icon.failed')}
        </p>
      ) : null}
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) onFile(file)
        }}
      />
    </div>
  )
}

/** The palette under the tabs. Images keep their own colors, so it hides for them. */
function ColorPicker({
  project,
  onPick
}: {
  project: Project
  onPick: (color: number | null) => void
}) {
  const { t } = useTranslation()
  const name = useId()
  const { color } = project.settings
  return (
    <fieldset className="owlto-project-colors">
      <legend className="sr-only">{t('projectSettings.color')}</legend>
      {[null, ...COLORS].map((value) => (
        <label
          key={value ?? 'auto'}
          className={value ? 'swatch' : 'swatch auto'}
          style={{ '--owl-c': projectHue(project.id, value) } as React.CSSProperties}
        >
          <input
            type="radio"
            name={name}
            className="sr-only"
            checked={color === value}
            onChange={() => onPick(value)}
          />
          <span className="sr-only">
            {value
              ? t('projectSettings.color.option', { number: value })
              : t('projectSettings.color.auto')}
          </span>
        </label>
      ))}
    </fieldset>
  )
}

/**
 * The icon row of a project's general page: the project's tile, which opens a picker with
 * emoji and image upload, plus the tile color and a way back to the initial.
 */
export function ProjectIconSetting({
  project,
  onSave
}: {
  project: Project
  onSave: (settings: Partial<ProjectSettings>) => void
}) {
  const { t } = useTranslation()
  const labelId = useId()
  const tabsId = useId()
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const { icon, color } = project.settings
  const [tab, setTab] = useState<Tab>(() => tabFor(icon))
  const [query, setQuery] = useState('')
  const [failed, setFailed] = useState(false)
  const saveIcon = (next: ProjectIconValue) => {
    setFailed(false)
    onSave({ icon: next })
  }
  // A picked image that is not square waits here while the user picks the part to keep.
  const [pending, setPending] = useState<{ bitmap: ImageBitmap; url: string } | null>(null)
  useEffect(() => {
    if (!pending) return
    return () => {
      pending.bitmap.close()
      URL.revokeObjectURL(pending.url)
    }
  }, [pending])
  const saveImage = (image: ImageBitmap, crop: SquareCrop) => {
    try {
      saveIcon({
        kind: 'image',
        src: squareImage(image, crop, ICON_SIZE, PROJECT_ICON_IMAGE_LIMIT)
      })
      setOpen(false)
    } catch {
      setFailed(true)
    }
    setPending(null)
  }
  const pickFile = (file: File) => {
    setFailed(false)
    createImageBitmap(file).then(
      (bitmap) => {
        if (bitmap.width === bitmap.height) {
          saveImage(bitmap, centeredSquare(bitmap.width, bitmap.height))
          bitmap.close()
        } else setPending({ bitmap, url: URL.createObjectURL(file) })
      },
      () => setFailed(true)
    )
  }
  const close = () => {
    setOpen(false)
    setPending(null)
  }
  const selectTab = (next: Tab) => {
    setTab(next)
    setQuery('')
    setPending(null)
  }
  const onTabKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    event.preventDefault()
    const next = TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length]
    selectTab(next)
    document.getElementById(`${tabsId}-${next}`)?.focus()
  }
  return (
    <SettingRow
      label={t('projectSettings.icon')}
      labelId={labelId}
      description={t('projectSettings.iconHelp')}
      detail={
        <>
          <button
            type="button"
            ref={setAnchor}
            className="owlto-project-icon-preview"
            aria-labelledby={labelId}
            aria-haspopup="dialog"
            aria-expanded={open}
            style={{ '--owl-c': projectHue(project.id, color) } as React.CSSProperties}
            onClick={() => {
              if (open) return close()
              setTab(tabFor(icon))
              setQuery('')
              setFailed(false)
              setOpen(true)
            }}
          >
            <ProjectIcon project={project} />
          </button>
          <AnchoredPopover
            anchor={anchor}
            open={open}
            onClose={close}
            label={t('projectSettings.icon.picker')}
            className="owlto-icon-picker"
          >
            <div
              className="owlto-icon-picker-tabs"
              role="tablist"
              aria-label={t('projectSettings.icon.picker')}
              onKeyDown={onTabKey}
            >
              {TABS.map((id) => (
                <button
                  type="button"
                  role="tab"
                  key={id}
                  id={`${tabsId}-${id}`}
                  aria-selected={tab === id}
                  aria-controls={`${tabsId}-panel`}
                  tabIndex={tab === id ? 0 : -1}
                  onClick={() => selectTab(id)}
                >
                  {t(`projectSettings.icon.tab.${id}`)}
                </button>
              ))}
            </div>
            <div
              role="tabpanel"
              id={`${tabsId}-panel`}
              aria-labelledby={`${tabsId}-${tab}`}
              className="owlto-icon-picker-panel"
            >
              {tab === 'upload' && pending ? (
                <ImageCropper
                  src={pending.url}
                  width={pending.bitmap.width}
                  height={pending.bitmap.height}
                  onCancel={() => setPending(null)}
                  onSave={(crop) => saveImage(pending.bitmap, crop)}
                />
              ) : tab === 'upload' ? (
                <UploadPane failed={failed} onFile={pickFile} />
              ) : (
                <>
                  <label className="owlto-icon-picker-search">
                    <SearchIcon size={16} />
                    <input
                      data-autofocus
                      value={query}
                      placeholder={t('projectSettings.icon.searchEmoji')}
                      aria-label={t('projectSettings.icon.searchEmoji')}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </label>
                  <div className="owlto-icon-picker-scroll">
                    <EmojiGrid
                      query={query}
                      current={icon.kind === 'emoji' ? icon.value : null}
                      onPick={(value) => saveIcon({ kind: 'emoji', value })}
                    />
                  </div>
                </>
              )}
            </div>
            <div className="owlto-icon-picker-foot">
              {icon.kind === 'image' ? (
                <span />
              ) : (
                <ColorPicker project={project} onPick={(next) => onSave({ color: next })} />
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={icon.kind === 'letter'}
                onClick={() => saveIcon({ kind: 'letter' })}
              >
                {t('projectSettings.icon.useInitial')}
              </Button>
            </div>
          </AnchoredPopover>
        </>
      }
    />
  )
}
