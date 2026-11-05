import { IconButton } from '@renderer/components/ui/icon-button'
import { ArrowUp, Loader2, Square, X } from 'lucide-react'
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CodexRouter } from '../../../shared/codex'
import type { RouterWorker } from '../../../shared/router'
import { byRelevance, workerTitle } from './activity'
import { useRouterStore } from './store'
import { WorkerDot } from './WorkerLink'

const MENTION = /(?:^|\s)@([^\s@]*)$/
const MENU_SIZE = 6

function useMentions(router: CodexRouter | undefined, query: string | null): RouterWorker[] {
  const workers = useRouterStore((s) => s.workers)
  return useMemo(() => {
    if (query === null || !router) return []
    const needle = query.toLocaleLowerCase()
    return workers
      .filter(
        (w) =>
          w.routerId === router.id &&
          w.status !== 'removed' &&
          (workerTitle(w).toLocaleLowerCase().includes(needle) || w.id.includes(needle))
      )
      .sort(byRelevance)
      .slice(0, MENU_SIZE)
  }, [workers, router, query])
}
/**
 * The one input in the app. Text goes to the project's Router unless a worker
 * is addressed, by `@` here or by `target` when the map has one selected.
 */
export function RouterComposer({
  projectId,
  router,
  target,
  onClearTarget,
  compact = false,
  note
}: {
  projectId: string | null
  router: CodexRouter | undefined
  target?: RouterWorker | null
  onClearTarget?: () => void
  compact?: boolean
  note?: string
}) {
  const { t } = useTranslation()
  const { open, send, interrupt, sending } = useRouterStore()
  const [text, setText] = useState('')
  const [mention, setMention] = useState<RouterWorker | null>(null)
  const [caret, setCaret] = useState(0)
  const [highlight, setHighlight] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const addressed = target ?? mention
  const query = dismissed || addressed ? null : (MENTION.exec(text.slice(0, caret))?.[1] ?? null)
  const options = useMentions(router, query)
  const running = router?.status === 'running'
  const label = t(addressed ? 'router.promptWorker' : 'router.prompt')
  useEffect(() => {
    textarea.current?.focus()
  }, [])
  useEffect(() => {
    if (!textarea.current) return
    textarea.current.style.height = 'auto'
    if (text) textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 220)}px`
  }, [text])
  function pick(worker: RouterWorker) {
    const before = text.slice(0, caret).replace(/@[^\s@]*$/, '')
    setText(before + text.slice(caret))
    setCaret(before.length)
    setMention(worker)
    setHighlight(0)
    textarea.current?.focus()
  }
  async function submit() {
    const message = text.trim()
    if (!projectId || !message || sending) return
    const current = router ?? (await open(projectId))
    if (!current) return
    if (await send(current.id, message, addressed?.id)) {
      setText('')
      setMention(null)
    }
  }
  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (options.length) {
      const step = { ArrowDown: 1, ArrowUp: -1 }[event.key]
      if (step) {
        event.preventDefault()
        setHighlight((i) => (i + step + options.length) % options.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        pick(options[Math.min(highlight, options.length - 1)])
        return
      }
      if (event.key === 'Escape') {
        event.stopPropagation()
        setDismissed(true)
        return
      }
    }
    if (event.key === 'Backspace' && !text && mention) setMention(null)
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void submit()
    }
  }
  return (
    <div className={compact ? 'router-composer compact' : 'router-composer'}>
      {options.length ? (
        <div className="router-mentions" role="listbox" aria-label={t('router.workers')}>
          {options.map((worker, index) => (
            <button
              type="button"
              role="option"
              aria-selected={index === highlight}
              key={worker.id}
              onPointerDown={(event) => {
                // Keeps focus and the caret in the textarea.
                event.preventDefault()
                pick(worker)
              }}
            >
              <WorkerDot worker={worker} />
              <span>{workerTitle(worker)}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="codex-composer">
        {addressed ? (
          <div className="router-target">
            <WorkerDot worker={addressed} />
            <span>{workerTitle(addressed)}</span>
            <IconButton
              size="sm"
              label={t('router.clearTarget', { title: workerTitle(addressed) })}
              icon={<X size={12} />}
              onClick={() => (target ? onClearTarget?.() : setMention(null))}
            />
          </div>
        ) : null}
        <textarea
          ref={textarea}
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            setCaret(event.target.selectionStart)
            setDismissed(false)
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onKeyDown={keyDown}
          placeholder={label}
          aria-label={label}
          rows={compact ? 1 : 2}
          disabled={!projectId || sending}
        />
        <div className="codex-composer-toolbar">
          <div className="codex-composer-config" />
          {running && !addressed && router ? (
            <IconButton
              className="codex-stop"
              label={t('router.stop')}
              tooltip={t('router.stop')}
              icon={<Square size={13} fill="currentColor" />}
              onClick={() => void interrupt(router.id)}
            />
          ) : null}
          <IconButton
            variant="default"
            className="codex-send"
            label={t(addressed ? 'router.sendWorker' : 'router.send')}
            tooltip={t(addressed ? 'router.sendWorker' : 'router.send')}
            icon={sending ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={17} />}
            disabled={!projectId || !text.trim() || sending}
            onClick={() => void submit()}
          />
        </div>
      </div>
      {compact ? null : (
        <div className="codex-composer-note">
          <span>{note ?? t('sendHint')}</span>
          {router?.tokens ? <span>{t('router.tokens', { count: router.tokens })}</span> : null}
        </div>
      )}
    </div>
  )
}
