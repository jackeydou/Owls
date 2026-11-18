import {
  ChevronRightIcon,
  FileIcon,
  GlobeIcon,
  ScrollTextIcon
} from '@renderer/components/ui/icons'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Streamdown } from 'streamdown'
import type { WorkerReport } from '../../../shared/router'
import { MarkdownLink, markdownLinkComponents } from '../app/MarkdownLink'
import { FileLink } from '../files/FileLink'
import { markdownRemarkPlugins } from '../files/remark-file-links'

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
        <Streamdown
          controls={false}
          components={markdownLinkComponents}
          remarkPlugins={markdownRemarkPlugins}
        >
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

/** A reported file: its name opens it in the file viewer, with its folder beside it. */
function FileArtifact({ entry, projectPath }: { entry: Artifact; projectPath: string }) {
  const { name, folder } = filePath(entry.ref, projectPath)
  return (
    <span className="worker-artifact-ref">
      <FileLink path={entry.ref.trim()} className="worker-artifact-name">
        {name}
      </FileLink>
      {folder ? <span className="worker-artifact-folder">{folder}</span> : null}
    </span>
  )
}

function ArtifactBody({ entry, projectPath }: { entry: Artifact; projectPath: string }) {
  if (entry.kind === 'note') return <NoteArtifact text={entry.ref} />
  if (entry.kind === 'url')
    return (
      <span className="worker-artifact-ref">
        <MarkdownLink href={entry.ref.trim()}>{urlLabel(entry.ref.trim())}</MarkdownLink>
      </span>
    )
  return <FileArtifact entry={entry} projectPath={projectPath} />
}

const ICONS = { file: FileIcon, url: GlobeIcon, note: ScrollTextIcon } as const

/**
 * What a worker's report points at, set like a paper's references: a numbered
 * list under a rule, each entry marked by its kind.
 */
export function WorkerArtifacts({
  artifacts,
  projectPath
}: {
  artifacts: WorkerReport['artifacts']
  projectPath: string
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
              <ArtifactBody entry={entry} projectPath={projectPath} />
            </li>
          )
        })}
      </ol>
    </section>
  )
}
