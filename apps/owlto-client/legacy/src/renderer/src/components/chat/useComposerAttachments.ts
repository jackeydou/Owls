import { useI18n } from '@renderer/lib/i18n'
import { useCallback, useEffect, useState } from 'react'
import type { AttachmentInput, MessageAttachment } from '../../../../preload/index.d'
import {
  COMPOSER_ADD_ATTACHMENTS_EVENT,
  PENDING_CHAT_ATTACHMENTS_STORAGE_KEY
} from './composer-events'

function appendUniqueAttachments(
  current: MessageAttachment[],
  nextAttachments: MessageAttachment[]
): MessageAttachment[] {
  const seen = new Set(current.map((attachment) => attachment.path))
  return [...current, ...nextAttachments.filter((attachment) => !seen.has(attachment.path))]
}

export function useComposerAttachments({ focusEditor }: { focusEditor: () => void }): {
  attachmentError: string | null
  attachments: MessageAttachment[]
  clearAttachments: () => void
  clearAttachmentError: () => void
  handlePickAttachments: () => void
  removeLastAttachment: () => void
  removeAttachment: (id: string) => void
  replaceAttachments: (nextAttachments: MessageAttachment[]) => void
} {
  const { t } = useI18n()
  const [attachments, setAttachments] = useState<MessageAttachment[]>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)

  const addAttachmentInputs = useCallback(
    async (inputs: AttachmentInput[]): Promise<void> => {
      const normalized = inputs.filter((item) => item.path.trim())
      if (normalized.length === 0) return

      try {
        const nextAttachments = await window.api.attachments.statPaths(normalized)
        setAttachments((current) => appendUniqueAttachments(current, nextAttachments))
        setAttachmentError(nextAttachments.length === 0 ? t('chat.attachment.unavailable') : null)
        focusEditor()
      } catch (error) {
        console.error('Failed to add attachments', error)
        setAttachmentError(t('chat.attachment.unavailable'))
      }
    },
    [focusEditor, t]
  )

  useEffect(() => {
    const handleExternalAttachments = (event: Event): void => {
      const detail = (event as CustomEvent<AttachmentInput[]>).detail
      if (Array.isArray(detail)) {
        void addAttachmentInputs(detail)
      }
    }

    const raw = window.sessionStorage.getItem(PENDING_CHAT_ATTACHMENTS_STORAGE_KEY)
    if (raw) {
      window.sessionStorage.removeItem(PENDING_CHAT_ATTACHMENTS_STORAGE_KEY)
      try {
        const parsed = JSON.parse(raw) as unknown
        if (Array.isArray(parsed)) {
          const inputs = parsed.filter((item): item is AttachmentInput => {
            return (
              typeof item === 'object' &&
              item !== null &&
              'path' in item &&
              typeof item.path === 'string'
            )
          })
          void addAttachmentInputs(inputs)
        }
      } catch (error) {
        console.error('Failed to load pending artifact attachments', error)
      }
    }

    window.addEventListener(COMPOSER_ADD_ATTACHMENTS_EVENT, handleExternalAttachments)
    return () =>
      window.removeEventListener(COMPOSER_ADD_ATTACHMENTS_EVENT, handleExternalAttachments)
  }, [addAttachmentInputs])

  const attachmentInputsFromFiles = useCallback((files: FileList | File[]): AttachmentInput[] => {
    return Array.from(files).flatMap((file) => {
      const path = window.api.attachments.getPathForFile(file)
      if (!path) return []
      return [{ path, name: file.name, mimeType: file.type || null }]
    })
  }, [])

  const clipboardImageFiles = useCallback((data: DataTransfer): File[] => {
    const files = Array.from(data.files)
    const pathBackedFiles = new Set(
      files.filter((file) => window.api.attachments.getPathForFile(file))
    )
    const memoryImages = files.filter(
      (file) =>
        file.type.startsWith('image/') &&
        !pathBackedFiles.has(file) &&
        !window.api.attachments.getPathForFile(file)
    )
    if (memoryImages.length > 0) return memoryImages
    if (files.length > 0) return []

    return Array.from(data.items).flatMap((item) => {
      if (item.kind !== 'file' || !item.type.startsWith('image/')) return []
      const file = item.getAsFile()
      return file ? [file] : []
    })
  }, [])

  const addClipboardAttachments = useCallback(
    async (data: DataTransfer): Promise<boolean> => {
      const pathInputs = attachmentInputsFromFiles(data.files)
      const imageFiles = clipboardImageFiles(data)
      if (pathInputs.length === 0 && imageFiles.length === 0) return false

      try {
        const pathAttachments =
          pathInputs.length > 0 ? await window.api.attachments.statPaths(pathInputs) : []
        const pastedImages = (
          await Promise.all(
            imageFiles.map(async (file) =>
              window.api.attachments.saveClipboardImage({
                name: file.name || undefined,
                mimeType: file.type || 'image/png',
                data: await file.arrayBuffer()
              })
            )
          )
        ).filter((attachment): attachment is MessageAttachment => Boolean(attachment))
        const nextAttachments = [...pathAttachments, ...pastedImages]

        setAttachments((current) => appendUniqueAttachments(current, nextAttachments))
        setAttachmentError(nextAttachments.length === 0 ? t('chat.attachment.unavailable') : null)
        focusEditor()
      } catch (error) {
        console.error('Failed to paste attachments', error)
        setAttachmentError(t('chat.attachment.unavailable'))
      }
      return true
    },
    [attachmentInputsFromFiles, clipboardImageFiles, focusEditor, t]
  )

  useEffect(() => {
    const handleWindowPaste = (event: ClipboardEvent): void => {
      const data = event.clipboardData
      if (!data) return
      if (
        attachmentInputsFromFiles(data.files).length === 0 &&
        clipboardImageFiles(data).length === 0
      ) {
        return
      }
      event.preventDefault()
      void addClipboardAttachments(data)
    }

    window.addEventListener('paste', handleWindowPaste)
    return () => window.removeEventListener('paste', handleWindowPaste)
  }, [addClipboardAttachments, attachmentInputsFromFiles, clipboardImageFiles])

  const handlePickAttachments = useCallback((): void => {
    void window.api.attachments
      .pick()
      .then((items) => {
        setAttachments((current) => appendUniqueAttachments(current, items))
        setAttachmentError(null)
        focusEditor()
      })
      .catch((error) => {
        console.error('Failed to pick attachments', error)
        setAttachmentError(t('chat.attachment.unavailable'))
      })
  }, [focusEditor, t])

  const removeAttachment = useCallback((id: string): void => {
    setAttachments((current) => current.filter((item) => item.id !== id))
  }, [])

  const removeLastAttachment = useCallback((): void => {
    setAttachments((current) => current.slice(0, -1))
  }, [])

  const replaceAttachments = useCallback((nextAttachments: MessageAttachment[]): void => {
    setAttachments(nextAttachments)
  }, [])

  const clearAttachments = useCallback((): void => {
    setAttachments([])
    setAttachmentError(null)
  }, [])

  const clearAttachmentError = useCallback((): void => {
    setAttachmentError(null)
  }, [])

  return {
    attachmentError,
    attachments,
    clearAttachments,
    clearAttachmentError,
    handlePickAttachments,
    removeLastAttachment,
    removeAttachment,
    replaceAttachments
  }
}
