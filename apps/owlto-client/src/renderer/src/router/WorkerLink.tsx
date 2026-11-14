import { createContext, type ReactNode, useContext } from 'react'
import type { RouterWorker } from '../../../shared/router'
import type { MarkdownExtension } from '../app/Conversation'
import { OwlAvatar } from '../app/OwlAvatar'
import { isWorking, workerTitle, workerTone } from './activity'
import { useRouterStore } from './store'

/** The Router whose conversation is being rendered; a reference to any other worker is text. */
export const RouterIdContext = createContext<string | null>(null)

export function WorkerDot({ worker }: { worker: RouterWorker }) {
  return <i className={`router-dot ${workerTone(worker)}`} aria-hidden />
}
/** The provider's owl, typing while the worker runs, badged with the worker's state. */
export function WorkerAvatar({ worker }: { worker: RouterWorker }) {
  return (
    <span className="router-worker-avatar">
      <OwlAvatar speaker={worker.provider} working={isWorking(worker)} />
      <WorkerDot worker={worker} />
    </span>
  )
}
export function WorkerLink({ worker, children }: { worker: RouterWorker; children?: ReactNode }) {
  const showPanel = useRouterStore((s) => s.showPanel)
  return (
    <button
      type="button"
      className={`router-worker-link ${workerTone(worker)}`}
      onClick={() => showPanel({ kind: 'worker', workerId: worker.id })}
    >
      <span>{children ?? workerTitle(worker)}</span>
    </button>
  )
}
function InlineWorker(props: Record<string, unknown>) {
  const { worker: id } = props
  const children = props.children as ReactNode
  const routerId = useContext(RouterIdContext)
  const worker = useRouterStore((s) =>
    s.workers.find((w) => w.id === id && w.routerId === routerId && w.status !== 'removed')
  )
  return worker ? <WorkerLink worker={worker}>{children}</WorkerLink> : <span>{children}</span>
}
const WORKER_LINK = /\[([^\]\n]+)\]\(#worker-(w_[\w-]+)\)/g
const escapeHtml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
/**
 * Worker references become a custom tag instead of going through `components.a`,
 * which renders every web link as MarkdownLink. `worker` is not `id` since
 * sanitizing prefixes ids.
 */
export const workerMarkdown: MarkdownExtension = {
  allowedTags: { 'owlto-worker': ['worker'] },
  components: { 'owlto-worker': InlineWorker },
  literalTagContent: ['owlto-worker'],
  prepare: (text) =>
    text.replace(
      WORKER_LINK,
      (_, title: string, id: string) =>
        `<owlto-worker worker="${id}">${escapeHtml(title)}</owlto-worker>`
    )
}
