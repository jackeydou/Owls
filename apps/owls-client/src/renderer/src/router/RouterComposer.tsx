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
 * A message being written. Text goes to the thread's Router, creating the thread
 * on the first send, unless a worker is addressed, by `@` here or by `target`
 * when the map has one selected.
 */
export function useRouterDraft({
  projectId,
  router,
  target,
  isSendKey,
  chooseProject,
  onThread
}: {
  projectId: string | null
  router: CodexRouter | undefined
  target?: RouterWorker | null
  isSendKey: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean
  /** Asked for a project when the draft is sent with none. Null keeps the draft. */
  chooseProject?: () => Promise<string | null>
  /** Told which thread took the first message of a new one. */
  onThread?: (threadId: string) => void
}) {
  const { createThread, send, sending } = useRouterStore()
  /** A thread made by a send that failed, so trying again does not leave another. */
  const created = useRef<CodexRouter | null>(null)
  const [text, setText] = useState('')
  const [mention, setMention] = useState<RouterWorker | null>(null)
  const [caret, setCaret] = useState(0)
  const [highlight, setHighlight] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const choosing = useRef(false)
  const addressed = target ?? mention
  const query = dismissed || addressed ? null : (MENTION.exec(text.slice(0, caret))?.[1] ?? null)
  const options = useMentions(router, query)
  useEffect(() => {
    textarea.current?.focus()
  }, [])
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
    if (!message || sending || choosing.current) return
    choosing.current = true
    const chosen = router ? null : (projectId ?? (await chooseProject?.()) ?? null)
    choosing.current = false
    if (!router && !chosen && chooseProject) return
    const current = router ?? created.current ?? (await createThread(chosen))
    if (!current) return
    created.current = router ? null : current
    if (await send(current.id, message, addressed?.id)) {
      setText('')
      setMention(null)
      created.current = null
      if (!router) onThread?.(current.id)
    }
  }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
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
    if (isSendKey(event) && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void submit()
    }
  }
  return {
    text,
    sending,
    addressed,
    options,
    highlight,
    pick,
    submit,
    clearMention: () => setMention(null),
    textareaProps: {
      ref: textarea,
      value: text,
      onChange: (event: { target: HTMLTextAreaElement }) => {
        setText(event.target.value)
        setCaret(event.target.selectionStart)
        setDismissed(false)
      },
      onSelect: (event: { currentTarget: HTMLTextAreaElement }) =>
        setCaret(event.currentTarget.selectionStart),
      onKeyDown
    }
  }
}
export function MentionMenu({
  options,
  highlight,
  onPick
}: {
  options: RouterWorker[]
  highlight: number
  onPick: (worker: RouterWorker) => void
}) {
  const { t } = useTranslation()
  if (!options.length) return null
  return (
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
            onPick(worker)
          }}
        >
          <WorkerDot worker={worker} />
          <span>{workerTitle(worker)}</span>
        </button>
      ))}
    </div>
  )
}
export function DraftTarget({ worker, onClear }: { worker: RouterWorker; onClear: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="router-target">
      <WorkerDot worker={worker} />
      <span>{workerTitle(worker)}</span>
      <IconButton
        size="sm"
        label={t('router.clearTarget', { title: workerTitle(worker) })}
        icon={<X size={12} />}
        onClick={onClear}
      />
    </div>
  )
}
const isEnter = (event: KeyboardEvent) => event.key === 'Enter' && !event.shiftKey

/** The map's one-line input. It follows the map's selection. */
export function RouterComposer({
  projectId,
  router,
  target,
  onClearTarget
}: {
  projectId: string | null
  router: CodexRouter | undefined
  target?: RouterWorker | null
  onClearTarget?: () => void
}) {
  const { t } = useTranslation()
  const interrupt = useRouterStore((s) => s.interrupt)
  const draft = useRouterDraft({ projectId, router, target, isSendKey: isEnter })
  const { text, sending, addressed, textareaProps } = draft
  const { ref: textarea } = textareaProps
  const running = router?.status === 'running'
  const label = t(addressed ? 'router.promptWorker' : 'router.prompt')
  useEffect(() => {
    if (!textarea.current) return
    textarea.current.style.height = 'auto'
    if (text) textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 220)}px`
  }, [text, textarea])
  return (
    <div className="router-composer">
      <MentionMenu options={draft.options} highlight={draft.highlight} onPick={draft.pick} />
      <div className="codex-composer">
        {addressed ? (
          <DraftTarget
            worker={addressed}
            onClear={() => (target ? onClearTarget?.() : draft.clearMention())}
          />
        ) : null}
        <textarea
          {...textareaProps}
          placeholder={label}
          aria-label={label}
          rows={1}
          disabled={!projectId || sending}
        />
        <div className="codex-composer-toolbar">
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
            onClick={() => void draft.submit()}
          />
        </div>
      </div>
    </div>
  )
}
