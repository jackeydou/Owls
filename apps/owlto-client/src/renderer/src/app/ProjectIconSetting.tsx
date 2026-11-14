import { Button } from '@renderer/components/ui/button'
import { useEffect, useId, useRef, useState } from 'react'
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
import { SettingRow } from './SettingRow'

/** Side of the square an image icon is stored at: sharp at 2x in a 20px tile, and small. */
const ICON_SIZE = 96
const DEFAULT_EMOJI = '📁'
const COLORS = Array.from({ length: PROJECT_COLORS }, (_, index) => index + 1)

/**
 * Crops a picked image to its centered square and scales it to `ICON_SIZE`, so the
 * stored data URL stays small whatever the user picks. Rejects files it cannot decode.
 */
async function iconFromFile(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  try {
    const side = Math.min(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = ICON_SIZE
    canvas.height = ICON_SIZE
    const context = canvas.getContext('2d')
    if (!context) throw new Error('No 2D canvas')
    context.imageSmoothingQuality = 'high'
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      ICON_SIZE,
      ICON_SIZE
    )
    const png = canvas.toDataURL('image/png')
    if (png.length <= PROJECT_ICON_IMAGE_LIMIT) return png
    const jpeg = canvas.toDataURL('image/jpeg', 0.85)
    if (jpeg.length <= PROJECT_ICON_IMAGE_LIMIT) return jpeg
    throw new Error('Icon too large')
  } finally {
    bitmap.close()
  }
}

/** The emoji or short text of an emoji icon, saved when the field loses focus. */
function EmojiField({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    const next = draft.trim()
    if (!next) setDraft(value)
    else if (next !== value) onCommit(next)
  }
  return (
    <input
      className="router-input owlto-project-emoji"
      aria-label={t('projectSettings.icon.emojiLabel')}
      maxLength={16}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') setDraft(value)
      }}
    />
  )
}

/** The icon row of a project's general page: what kind of icon, its content, and its color. */
export function ProjectIconSetting({
  project,
  onSave
}: {
  project: Project
  onSave: (settings: Partial<ProjectSettings>) => void
}) {
  const { t } = useTranslation()
  const labelId = useId()
  const colorLabel = useId()
  const fileInput = useRef<HTMLInputElement>(null)
  const [failed, setFailed] = useState(false)
  const { icon, color } = project.settings
  const saveIcon = (next: ProjectIconValue) => {
    setFailed(false)
    onSave({ icon: next })
  }
  const kinds = [
    { kind: 'letter', pick: () => saveIcon({ kind: 'letter' }) },
    {
      kind: 'emoji',
      pick: () => saveIcon({ kind: 'emoji', value: DEFAULT_EMOJI })
    },
    { kind: 'image', pick: () => fileInput.current?.click() }
  ] as const
  return (
    <SettingRow
      label={t('projectSettings.icon')}
      labelId={labelId}
      description={t('projectSettings.iconHelp')}
      detail={
        <div className="owlto-project-icon-editor">
          <span
            className="owlto-project-icon-preview"
            style={{ '--owl-c': projectHue(project.id, color) } as React.CSSProperties}
          >
            <ProjectIcon project={project} />
          </span>
          <fieldset className="owlto-segmented" aria-labelledby={labelId}>
            {kinds.map(({ kind, pick }) => (
              <button
                type="button"
                key={kind}
                aria-pressed={icon.kind === kind}
                onClick={() => {
                  // Picking the same kind again only matters for an image: it replaces it.
                  if (icon.kind !== kind || kind === 'image') pick()
                }}
              >
                {t(`projectSettings.icon.${kind}`)}
              </button>
            ))}
          </fieldset>
          {icon.kind === 'emoji' ? (
            <EmojiField
              value={icon.value}
              onCommit={(value) => saveIcon({ kind: 'emoji', value })}
            />
          ) : null}
          {icon.kind === 'image' ? (
            <Button size="sm" variant="outline" onClick={() => fileInput.current?.click()}>
              {t('projectSettings.icon.replace')}
            </Button>
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
              if (!file) return
              iconFromFile(file).then(
                (src) => saveIcon({ kind: 'image', src }),
                () => setFailed(true)
              )
            }}
          />
          {icon.kind === 'image' ? null : (
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
                    name={colorLabel}
                    className="sr-only"
                    checked={color === value}
                    onChange={() => onSave({ color: value })}
                  />
                  <span className="sr-only">
                    {value
                      ? t('projectSettings.color.option', { number: value })
                      : t('projectSettings.color.auto')}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {failed ? (
            <p className="owlto-project-icon-error" role="alert">
              {t('projectSettings.icon.failed')}
            </p>
          ) : null}
        </div>
      }
    />
  )
}
