import { COMPOSER_ADD_ATTACHMENTS_EVENT } from '@renderer/components/chat/composer-events'
import { useCallback, useRef, useState } from 'react'
import type { AttachmentInput } from '../../../../preload/index.d'

function attachmentInputsFromFiles(files: FileList): AttachmentInput[] {
  return Array.from(files).flatMap((file) => {
    const path = window.api.attachments.getPathForFile(file)
    if (!path) return []
    return [{ path, name: file.name, mimeType: file.type || null }]
  })
}

function hasDraggedFiles(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes('Files')
}

export function usePageAttachmentDrop() {
  const pageDragDepthRef = useRef(0)
  const [pageDragActive, setPageDragActive] = useState(false)

  const handlePageDragEnter = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return
    event.preventDefault()
    pageDragDepthRef.current += 1
    setPageDragActive(true)
  }, [])

  const handlePageDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setPageDragActive(true)
  }, [])

  const handlePageDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return
    event.preventDefault()
    pageDragDepthRef.current = Math.max(0, pageDragDepthRef.current - 1)
    if (pageDragDepthRef.current === 0) {
      setPageDragActive(false)
    }
  }, [])

  const handlePageDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return
    event.preventDefault()
    pageDragDepthRef.current = 0
    setPageDragActive(false)

    const inputs = attachmentInputsFromFiles(event.dataTransfer.files)
    if (inputs.length > 0) {
      window.dispatchEvent(
        new CustomEvent<AttachmentInput[]>(COMPOSER_ADD_ATTACHMENTS_EVENT, { detail: inputs })
      )
    }
  }, [])

  return {
    handlePageDragEnter,
    handlePageDragLeave,
    handlePageDragOver,
    handlePageDrop,
    pageDragActive
  }
}
