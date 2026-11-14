import { ChevronRightIcon, FileCodeIcon } from '@renderer/components/ui/icons'
import { useTranslation } from 'react-i18next'
import type { DiffFile, DiffStats } from './diff'

/** Green additions and red deletions, as `+12 −3`. */
export function DiffCounts({ stats }: { stats: DiffStats }) {
  return (
    <span className="router-diff-counts">
      <span className="added">+{stats.added}</span>
      <span className="removed">−{stats.removed}</span>
    </span>
  )
}

function DiffFileCard({ file, projectPath }: { file: DiffFile; projectPath: string }) {
  const path =
    projectPath && file.path.startsWith(`${projectPath}/`)
      ? file.path.slice(projectPath.length + 1)
      : file.path
  return (
    <details className="router-diff-file" open>
      <summary>
        <ChevronRightIcon size={14} />
        <FileCodeIcon size={16} />
        <code>{path}</code>
        <DiffCounts stats={file} />
      </summary>
      {file.lines.length ? (
        <pre>
          {file.lines.map((line, index) => (
            // Lines repeat and never move, so their position is their identity.
            // biome-ignore lint/suspicious/noArrayIndexKey: static rows of one diff
            <div key={index} className={line.kind}>
              <span aria-hidden>
                {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}
              </span>
              {line.text || '\n'}
            </div>
          ))}
        </pre>
      ) : null}
    </details>
  )
}

export function DiffView({ files, projectPath }: { files: DiffFile[]; projectPath: string }) {
  const { t } = useTranslation()
  if (!files.length) return <p className="router-panel-empty">{t('noChanges')}</p>
  return (
    <div className="router-diff">
      {files.map((file) => (
        <DiffFileCard key={file.path} file={file} projectPath={projectPath} />
      ))}
    </div>
  )
}
