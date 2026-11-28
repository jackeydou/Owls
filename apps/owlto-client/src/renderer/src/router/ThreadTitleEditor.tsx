import { IconButton } from '@renderer/components/ui/icon-button'
import { CheckIcon, XIcon } from '@renderer/components/ui/icons'
import { cn } from '@renderer/lib/utils'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Router } from '../../../shared/app'
import { THREAD_TITLE_LIMIT } from '../../../shared/router'
import { threadTitle, useThreadTitle } from './activity'
import { useRouterStore } from './store'

/**
 * Renames a thread in place: the sidebar row and the thread's top bar swap their title for
 * this field. Enter or the check saves, Escape or the cross cancels, and leaving the field
 * saves what was typed. An empty or unchanged name just closes it.
 */
export function ThreadTitleEditor({
  thread,
  onClose,
  className
}: {
  thread: Router
  onClose: () => void
  className?: string
}) {
  const { t } = useTranslation()
  const untitled = useThreadTitle()
  const rename = useRouterStore((s) => s.rename)
  const [value, setValue] = useState(() => threadTitle(thread, untitled))
  const [saving, setSaving] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  const save = async () => {
    if (saving) return
    const title = value.trim()
    if (!title || title === thread.title) return onClose()
    setSaving(true)
    const saved = await rename(thread.id, title)
    setSaving(false)
    // A failed save keeps the field open with the text, and the store shows the error.
    if (saved) onClose()
  }
  // The buttons keep focus in the field, so pressing them never counts as leaving it.
  const keepFocus = (event: React.MouseEvent) => event.preventDefault()
  return (
    <div className={cn('thread-title-editor', className)}>
      <input
        ref={input}
        value={value}
        maxLength={THREAD_TITLE_LIMIT}
        aria-label={t('threadActions.titleField')}
        disabled={saving}
        spellCheck={false}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Enter') {
            event.preventDefault()
            void save()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onClose()
          }
        }}
        onBlur={() => void save()}
      />
      <IconButton
        size="custom"
        className="thread-title-editor-save"
        label={t('threadActions.save')}
        icon={<CheckIcon size={14} />}
        pending={saving}
        onMouseDown={keepFocus}
        onClick={() => void save()}
      />
      <IconButton
        size="custom"
        className="thread-title-editor-cancel"
        label={t('threadActions.cancel')}
        icon={<XIcon size={14} />}
        disabled={saving}
        onMouseDown={keepFocus}
        onClick={onClose}
      />
    </div>
  )
}
