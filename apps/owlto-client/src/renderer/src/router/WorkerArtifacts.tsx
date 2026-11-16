import {
  ChevronRightIcon,
  FileIcon,
  GlobeIcon,
  ScrollTextIcon
} from '@renderer/components/ui/icons'
import { useAction } from '@renderer/components/ui/use-action'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Streamdown } from 'streamdown'
import type { WorkerAction, WorkerArtifactAction, WorkerReport } from '../../../shared/router'
import { MarkdownLink, markdownLinkComponents } from '../app/MarkdownLink'
import { useRouterStore } from './store'

type Artifact = WorkerReport['artifacts'][number]

/** Notes longer than this, or with more than one line, start folded to a few lines. */
const NOTE_FOLD_LENGTH = 160

/** A file's name, and the folder it is in when that is safe to show. */
function filePath(ref: string, projectPath: string): { name: string; folder: string } {
  const path = ref.trim().replace(/^file:\/\//, '')
  const parts = path.split(/[\\/]/)
  const name = parts.at(-1) || path
  // A path outside the project may be private, so only its name is shown (RFC section 6).
  if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) {
    if (!path.startsWith(`${projectPath}/`)) return { name, folder: '' }
    return { name, folder: path.slice(projectPath.length + 1, -name.length).replace(/[\\/]$/, '') }
  }
  return { name, folder: parts.slice(0, -1).join('/') }
}

/** A URL without its scheme, as a reference list would print it. */
const urlLabel = (ref: string) => ref.replace(/^https?:\/\//i, '').replace(/\/$/, '')

/** A note is Markdown the worker wrote, so it is rendered, and folded when long. */
function NoteArtifact({ text }: { text: string }) {
  const { t } = useTranslation()
  const long = text.length > NOTE_FOLD_LENGTH || text.includes('\n')
  const [open, setOpen] = useState(false)
  return (
    <div className="worker-artifact-note">
      <div
        className="owlto-markdown markdown-body worker-artifact-note-body"
        data-folded={long && !open ? '' : undefined}
      >
        <Streamdown controls={false} components={markdownLinkComponents}>
          {text}
        </Streamdown>
      </div>
      {long ? (
        <button
          type="button"
          className="worker-artifact-more"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <ChevronRightIcon size={12} />
          {t(open ? 'worker.artifactLess' : 'worker.artifactMore')}
        </button>
      ) : null}
    </div>
  )
}

/** A reported file: its name opens it in its default app, with its folder beside it. */
function FileArtifact({
  entry,
  projectPath,
  target
}: {
  entry: Artifact
  projectPath: string
  target: WorkerArtifactAction | null
}) {
  const { t } = useTranslation()
  const openWorkerArtifact = useRouterStore((s) => s.openWorkerArtifact)
  // The file opening in another app is the result; a failure shows as the store's error.
  const { phase, run } = useAction(async () => {
    if (!target || !(await openWorkerArtifact(target))) throw new Error('open failed')
    return 'quiet'
  })
  const { name, folder } = filePath(entry.ref, projectPath)
  if (!target)
    return (
      <span className="worker-artifact-ref">
        <span className="worker-artifact-name">{name}</span>
        {folder ? <span className="worker-artifact-folder">{folder}</span> : null}
      </span>
    )
  return (
    <span className="worker-artifact-ref">
      <button
        type="button"
        className="worker-artifact-name"
        data-phase={phase}
        aria-busy={phase === 'pending'}
        aria-label={t('worker.artifactOpen', { name })}
        onClick={() => void run()}
      >
        {name}
      </button>
      {folder ? <span className="worker-artifact-folder">{folder}</span> : null}
    </span>
  )
}

function ArtifactBody({
  entry,
  projectPath,
  target
}: {
  entry: Artifact
  projectPath: string
  target: WorkerArtifactAction | null
}) {
  if (entry.kind === 'note') return <NoteArtifact text={entry.ref} />
  if (entry.kind === 'url')
    return (
      <span className="worker-artifact-ref">
        <MarkdownLink href={entry.ref.trim()}>{urlLabel(entry.ref.trim())}</MarkdownLink>
      </span>
    )
  return <FileArtifact entry={entry} projectPath={projectPath} target={target} />
}

const ICONS = { file: FileIcon, url: GlobeIcon, note: ScrollTextIcon } as const

/**
 * What a worker's report points at, set like a paper's references: a numbered
 * list under a rule, each entry marked by its kind.
 */
export function WorkerArtifacts({
  artifacts,
  projectPath,
  current
}: {
  artifacts: WorkerReport['artifacts']
  projectPath: string
  /**
   * The worker these are the latest report of. Main finds a file by its place in that report,
   * so an earlier report's files, passed null, are shown but cannot be opened.
   */
  current: WorkerAction | null
}) {
  const { t } = useTranslation()
  if (!artifacts.length) return null
  return (
    <section className="worker-artifacts" aria-label={t('worker.artifacts')}>
      <h3>
        {t('worker.artifacts')}
        <span>{artifacts.length}</span>
      </h3>
      <ol>
        {artifacts.map((entry, index) => {
          const Icon = ICONS[entry.kind]
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: a report's artifacts never reorder, and two may be equal
            <li key={index} className="worker-artifact" data-kind={entry.kind}>
              <span className="worker-artifact-index" aria-hidden>
                {index + 1}
              </span>
              <Icon size={14} aria-label={t(`worker.artifactKind.${entry.kind}`)} />
              <ArtifactBody
                entry={entry}
                projectPath={projectPath}
                target={current ? { ...current, index } : null}
              />
            </li>
          )
        })}
      </ol>
    </section>
  )
}
