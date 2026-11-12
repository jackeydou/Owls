import { IconButton } from '@renderer/components/ui/icon-button'
import { XIcon } from '@renderer/components/ui/icons'
import { type Editor, Node } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Project, Router } from '../../../shared/app'
import type { RouterWorker } from '../../../shared/router'
import { useAppStore } from '../app/store'
import { byRelevance, projectHue, workerTitle } from './activity'
import { ProjectIcon } from './ProjectIcon'
import { useRouterStore } from './store'
import { WorkerDot } from './WorkerLink'

const MENTION = /(?:^|\s)@([^\s@]*)$/
const MENU_SIZE = 6
/** Stands in for inline nodes when the text before the caret is searched for `@`. */
const LEAF = '￼'

/**
 * A project named in the draft. It reads as `@name` in the message, and the first
 * one in a new thread's first message becomes that thread's project.
 */
const ProjectMention = Node.create({
  name: 'projectMention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,
  addAttributes() {
    return {
      id: { default: null, parseHTML: (el) => el.getAttribute('data-project') },
      label: { default: '', parseHTML: (el) => el.getAttribute('data-label') ?? '' }
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-project]' }]
  },
  renderHTML({ node }) {
    return [
      'span',
      { class: 'router-mention', 'data-project': node.attrs.id, 'data-label': node.attrs.label },
      `@${node.attrs.label}`
    ]
  },
  renderText({ node }) {
    return `@${node.attrs.label}`
  }
})

/** Plain text only: a message is sent as text, so formatting would be lost on the way. */
const PlainText = StarterKit.configure({
  blockquote: false,
  bold: false,
  bulletList: false,
  code: false,
  codeBlock: false,
  dropcursor: false,
  gapcursor: false,
  heading: false,
  horizontalRule: false,
  italic: false,
  listItem: false,
  listKeymap: false,
  link: false,
  orderedList: false,
  strike: false,
  underline: false,
  trailingNode: false
})

export type MentionOption =
  | { kind: 'project'; project: Project }
  | { kind: 'worker'; worker: RouterWorker }

const optionKey = (option: MentionOption) =>
  option.kind === 'project' ? `project:${option.project.id}` : `worker:${option.worker.id}`

/** The `@query` the caret is in, as a range of the document. */
type Trigger = { query: string; from: number; to: number }

function triggerAt(editor: Editor): Trigger | null {
  const { selection } = editor.state
  if (!selection.empty) return null
  const { $from } = selection
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, LEAF)
  const match = MENTION.exec(before)
  if (!match) return null
  return { query: match[1], from: $from.pos - match[1].length - 1, to: $from.pos }
}

function firstProject(editor: Editor): string | null {
  let found: string | null = null
  editor.state.doc.descendants((node) => {
    if (found) return false
    if (node.type.name === 'projectMention' && typeof node.attrs.id === 'string')
      found = node.attrs.id
    return !found
  })
  return found
}

function useMentions(router: Router | undefined, query: string | null): MentionOption[] {
  const workers = useRouterStore((s) => s.workers)
  const projects = useAppStore((s) => s.projects)
  return useMemo(() => {
    if (query === null) return []
    const needle = query.toLocaleLowerCase()
    const projectOptions: MentionOption[] = projects
      .filter((p) => p.name.toLocaleLowerCase().includes(needle))
      .map((project) => ({ kind: 'project', project }))
    const workerOptions: MentionOption[] = router
      ? workers
          .filter(
            (w) =>
              w.routerId === router.id &&
              w.status !== 'removed' &&
              (workerTitle(w).toLocaleLowerCase().includes(needle) || w.id.includes(needle))
          )
          .sort(byRelevance)
          .map((worker) => ({ kind: 'worker', worker }))
      : []
    // In a thread, its workers come first: they are what `@` usually addresses there.
    return [...workerOptions, ...projectOptions].slice(0, MENU_SIZE)
  }, [workers, projects, router, query])
}

/**
 * A message being written. Text goes to the thread's Router, creating the thread
 * on the first send, unless a worker is addressed, by `@` here or by `target`
 * when the map has one selected. `@` also names projects; a new thread runs its
 * workers in the first project its first message names, or in `projectId`.
 */
export function useRouterDraft({
  projectId,
  router,
  target,
  isSendKey,
  disabled = false,
  chooseProject,
  onThread
}: {
  projectId: string | null
  router: Router | undefined
  target?: RouterWorker | null
  isSendKey: (event: KeyboardEvent) => boolean
  disabled?: boolean
  /** Asked for a project when the draft is sent with none. Null keeps the draft. */
  chooseProject?: () => Promise<string | null>
  /** Told which thread took the first message of a new one. */
  onThread?: (threadId: string) => void
}) {
  const { createThread, send, sending } = useRouterStore()
  /** A thread made by a send that failed, so trying again does not leave another. */
  const created = useRef<Router | null>(null)
  const [empty, setEmpty] = useState(true)
  const [mention, setMention] = useState<RouterWorker | null>(null)
  const [trigger, setTrigger] = useState<Trigger | null>(null)
  const [highlight, setHighlight] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const choosing = useRef(false)
  const addressed = target ?? mention
  const query = dismissed || !trigger ? null : trigger.query
  const options = useMentions(router, query).filter(
    (option) => !(addressed && option.kind === 'worker')
  )
  // ProseMirror keeps the props it was made with; the key handler reads the latest render.
  const keyDown = useRef<(event: KeyboardEvent) => boolean>(() => false)
  const editor = useEditor({
    extensions: [PlainText, ProjectMention],
    autofocus: 'end',
    editorProps: {
      attributes: { class: 'router-draft-input', role: 'textbox', 'aria-multiline': 'true' },
      handleKeyDown: (_view, event) => keyDown.current(event)
    },
    onUpdate: ({ editor }) => {
      setEmpty(!editor.getText().trim())
      setTrigger(triggerAt(editor))
      setDismissed(false)
    },
    onSelectionUpdate: ({ editor }) => setTrigger(triggerAt(editor))
  })
  useEffect(() => {
    editor.setEditable(!sending && !disabled, false)
  }, [editor, sending, disabled])
  function pick(option: MentionOption) {
    if (!trigger) return
    const range = { from: trigger.from, to: trigger.to }
    if (option.kind === 'worker') {
      editor.chain().focus().deleteRange(range).run()
      setMention(option.worker)
    } else {
      const { id, name } = option.project
      editor
        .chain()
        .focus()
        .insertContentAt(range, [
          { type: 'projectMention', attrs: { id, label: name } },
          { type: 'text', text: ' ' }
        ])
        .run()
    }
    setHighlight(0)
  }
  async function submit() {
    const message = editor.getText({ blockSeparator: '\n' }).trim()
    if (!message || sending || choosing.current) return
    choosing.current = true
    const chosen = router
      ? null
      : (firstProject(editor) ?? projectId ?? (await chooseProject?.()) ?? null)
    choosing.current = false
    if (!router && !chosen && chooseProject) return
    const current = router ?? created.current ?? (await createThread(chosen))
    if (!current) return
    created.current = router ? null : current
    if (await send(current.id, message, addressed?.id)) {
      editor.commands.clearContent(true)
      setMention(null)
      created.current = null
      if (!router) onThread?.(current.id)
    }
  }
  keyDown.current = (event) => {
    if (options.length) {
      const step = { ArrowDown: 1, ArrowUp: -1 }[event.key]
      if (step) {
        event.preventDefault()
        setHighlight((i) => (i + step + options.length) % options.length)
        return true
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        pick(options[Math.min(highlight, options.length - 1)])
        return true
      }
      if (event.key === 'Escape') {
        event.stopPropagation()
        setDismissed(true)
        return true
      }
    }
    if (event.key === 'Backspace' && editor.isEmpty && mention) {
      setMention(null)
      return true
    }
    if (isSendKey(event) && !event.isComposing) {
      event.preventDefault()
      void submit()
      return true
    }
    return false
  }
  return {
    editor,
    empty,
    sending,
    addressed,
    options,
    highlight,
    pick,
    submit,
    clearMention: () => setMention(null)
  }
}

/** The draft's text field. The placeholder shows while it is empty. */
export function DraftInput({
  editor,
  empty,
  label,
  placeholder
}: {
  editor: Editor
  empty: boolean
  label: string
  placeholder?: string
}) {
  useEffect(() => {
    const dom = editor.view.dom
    dom.setAttribute('aria-label', label)
    if (placeholder && empty) dom.setAttribute('data-placeholder', placeholder)
    else dom.removeAttribute('data-placeholder')
  }, [editor, label, placeholder, empty])
  return <EditorContent editor={editor} className="router-draft" />
}

export function MentionMenu({
  options,
  highlight,
  onPick
}: {
  options: MentionOption[]
  highlight: number
  onPick: (option: MentionOption) => void
}) {
  const { t } = useTranslation()
  if (!options.length) return null
  return (
    <div className="router-mentions" role="listbox" aria-label={t('router.mentions')}>
      {options.map((option, index) => (
        <button
          type="button"
          role="option"
          aria-selected={index === highlight}
          key={optionKey(option)}
          style={
            option.kind === 'project'
              ? ({
                  '--owl-c': projectHue(option.project.id, option.project.settings.color)
                } as CSSProperties)
              : undefined
          }
          onPointerDown={(event) => {
            // Keeps focus and the caret in the editor.
            event.preventDefault()
            onPick(option)
          }}
        >
          {option.kind === 'worker' ? (
            <>
              <WorkerDot worker={option.worker} />
              <span>{workerTitle(option.worker)}</span>
            </>
          ) : (
            <>
              <ProjectIcon project={option.project} />
              <span>{option.project.name}</span>
              <small>{t('router.mentionProject')}</small>
            </>
          )}
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
        icon={<XIcon size={12} />}
        onClick={onClear}
      />
    </div>
  )
}
