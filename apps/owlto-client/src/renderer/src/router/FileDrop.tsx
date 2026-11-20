import { PaperclipIcon } from '@renderer/components/ui/icons'
import { type DragEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const carriesFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files')

/**
 * Takes files dropped anywhere on an element and tells while some are dragged
 * over it. `add` null refuses drops, so the page shows nothing. A drop the
 * editor already took (it prevents the default) is not added again.
 */
export function useFileDrop(add: ((files: File[]) => void) | null) {
  const [over, setOver] = useState(false)
  // Enter and leave fire for every child crossed; the count reaches 0 only on leaving the page.
  const depth = useRef(0)
  const reset = () => {
    depth.current = 0
    setOver(false)
  }
  const handlers = {
    onDragEnter: (event: DragEvent) => {
      if (!add || !carriesFiles(event)) return
      event.preventDefault()
      depth.current += 1
      setOver(true)
    },
    onDragOver: (event: DragEvent) => {
      if (!add || !carriesFiles(event)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    },
    onDragLeave: (event: DragEvent) => {
      if (!add || !carriesFiles(event)) return
      depth.current = Math.max(0, depth.current - 1)
      if (!depth.current) setOver(false)
    },
    onDrop: (event: DragEvent) => {
      if (!add || !carriesFiles(event)) return
      reset()
      if (event.defaultPrevented) return
      event.preventDefault()
      const files = [...event.dataTransfer.files]
      if (files.length) add(files)
    }
  }
  return { over: Boolean(add) && over, handlers }
}

/** Covers the page while files are dragged over it. */
export function FileDropOverlay() {
  const { t } = useTranslation()
  return (
    <div className="file-drop-overlay" aria-hidden="true">
      <div className="file-drop-card">
        <span className="file-drop-icon">
          <PaperclipIcon size={20} />
        </span>
        <strong>{t('attachments.dropTitle')}</strong>
        <span>{t('attachments.dropHint')}</span>
      </div>
    </div>
  )
}
