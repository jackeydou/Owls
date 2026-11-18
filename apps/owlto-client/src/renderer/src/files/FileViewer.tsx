import { ActionIconButton } from '@renderer/components/ui/action-button'
import { IconButton } from '@renderer/components/ui/icon-button'
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  CheckIcon,
  CopyIcon,
  FileIcon,
  FolderIcon,
  LoaderIcon,
  RefreshIcon
} from '@renderer/components/ui/icons'
import { code } from '@streamdown/code'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Streamdown } from 'streamdown'
import type { FilePreview } from '../../../shared/file-preview'
import { failureMessage } from '../app/failures'
import { markdownLinkComponents } from '../app/MarkdownLink'
import { mermaidRenderer } from '../app/MermaidDiagram'
import { OpenInSplitButton } from '../router/OpenInButton'
import { useRouterStore } from '../router/store'
import { CodeView } from './CodeView'
import { FileBaseContext } from './FileLink'
import { markdownRemarkPlugins } from './remark-file-links'
import { useFilesStore } from './store'
import './files.css'

const plugins = { code, renderers: [mermaidRenderer] }
const MARKDOWN = /\.(md|mdx|markdown)$/i

/** Markdown opens rendered; the toggle in the head switches to its source. */
type MarkdownMode = 'preview' | 'source'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function CopyPathButton({ path }: { path: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1400)
    return () => clearTimeout(timer)
  }, [copied])
  const label = t(copied ? 'copied' : 'files.copyPath')
  return (
    <IconButton
      size="sm"
      label={label}
      tooltip={label}
      tooltipSide="bottom"
      icon={copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
      onClick={() => {
        void navigator.clipboard.writeText(path).then(() => setCopied(true))
      }}
    />
  )
}

function ModeToggle({
  mode,
  onChange
}: {
  mode: MarkdownMode
  onChange(mode: MarkdownMode): void
}) {
  const { t } = useTranslation()
  return (
    // biome-ignore lint/a11y/useSemanticElements: a segmented control is a group of two buttons.
    <div className="file-viewer-mode" role="group" aria-label={t('files.mode')}>
      {(['preview', 'source'] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={mode === value}
          onClick={() => onChange(value)}
        >
          {t(`files.${value}`)}
        </button>
      ))}
    </div>
  )
}

function FolderList({ preview }: { preview: FilePreview }) {
  const { t } = useTranslation()
  const openFile = useFilesStore((s) => s.openFile)
  if (preview.body.kind !== 'folder') return null
  const { entries, truncated } = preview.body
  if (!entries.length) return <p className="file-viewer-note">{t('files.emptyFolder')}</p>
  return (
    <>
      <ul className="file-viewer-folder" aria-label={preview.name}>
        {entries.map((entry) => (
          <li key={entry.name}>
            <button
              type="button"
              onClick={() =>
                openFile({ ref: `${preview.path}/${entry.name}`, base: { kind: 'none' } })
              }
            >
              {entry.folder ? <FolderIcon size={15} /> : <FileIcon size={15} />}
              <span>{entry.name}</span>
            </button>
          </li>
        ))}
      </ul>
      {truncated ? <p className="file-viewer-note">{t('files.folderTruncated')}</p> : null}
    </>
  )
}

function PreviewBody({ preview, mode }: { preview: FilePreview; mode: MarkdownMode }) {
  const { t } = useTranslation()
  const { body } = preview
  if (body.kind === 'folder') return <FolderList preview={preview} />
  if (body.kind === 'image')
    return (
      <div className="file-viewer-image">
        <img src={body.dataUrl} alt={preview.name} draggable={false} />
      </div>
    )
  if (body.kind === 'binary')
    return (
      <div className="file-viewer-state">
        <FileIcon size={22} />
        <p>{t('files.binary')}</p>
      </div>
    )
  return (
    <>
      {body.truncated ? (
        <p className="file-viewer-note">
          {t('files.truncated', { size: formatSize(preview.size) })}
        </p>
      ) : null}
      {MARKDOWN.test(preview.name) && mode === 'preview' ? (
        <FileBaseContext.Provider value={{ kind: 'file', path: preview.path }}>
          <div className="owlto-markdown markdown-body file-viewer-markdown">
            <Streamdown
              plugins={plugins}
              controls={false}
              components={markdownLinkComponents}
              remarkPlugins={markdownRemarkPlugins}
            >
              {body.text}
            </Streamdown>
          </div>
        </FileBaseContext.Provider>
      ) : (
        <CodeView text={body.text} line={preview.line} />
      )}
    </>
  )
}

/** The right sidebar's file viewer: the file a message pointed at, and ways to open it elsewhere. */
export function FileViewerPane() {
  const { t } = useTranslation()
  const target = useFilesStore((s) => s.target)
  const result = useFilesStore((s) => s.preview)
  const error = useFilesStore((s) => s.error)
  const loading = useFilesStore((s) => s.loading)
  const canGoBack = useFilesStore((s) => s.history.length > 0)
  const back = useFilesStore((s) => s.back)
  const reload = useFilesStore((s) => s.reload)
  const openFileIn = useRouterStore((s) => s.openFileIn)
  const [mode, setMode] = useState<MarkdownMode>('preview')
  const preview = result?.status === 'ok' ? result.preview : null
  const markdown = preview?.body.kind === 'text' && MARKDOWN.test(preview.name)

  if (!target)
    return (
      <section className="router-right-pane file-viewer" aria-label={t('router.panel.files')}>
        <header>
          <h2>{t('router.panel.files')}</h2>
        </header>
        <div className="file-viewer-state">
          <FileIcon size={22} />
          <p>{t('files.empty')}</p>
        </div>
      </section>
    )

  const title = preview?.name ?? target.ref.split('/').at(-1) ?? target.ref
  return (
    <section className="router-right-pane file-viewer" aria-label={t('router.panel.files')}>
      <header className="file-viewer-head">
        {canGoBack ? (
          <IconButton
            size="sm"
            label={t('files.back')}
            tooltip={t('files.back')}
            tooltipSide="bottom"
            icon={<ArrowLeftIcon size={15} />}
            onClick={back}
          />
        ) : null}
        <div className="file-viewer-title">
          <strong>
            {title}
            {preview?.line ? <span>:{preview.line}</span> : null}
          </strong>
          <span>{preview?.label ?? target.ref}</span>
        </div>
        <div className="file-viewer-actions">
          {markdown ? <ModeToggle mode={mode} onChange={setMode} /> : null}
          {preview ? <CopyPathButton path={preview.path} /> : null}
          <ActionIconButton
            size="sm"
            label={t('files.reload')}
            tooltip={t('files.reload')}
            tooltipSide="bottom"
            icon={<RefreshIcon size={15} />}
            onAction={async () => {
              if (!(await reload())) throw new Error('reload failed')
              return 'done'
            }}
          />
          {preview ? (
            <OpenInSplitButton open={(appId) => openFileIn({ path: preview.path, appId })} />
          ) : null}
        </div>
      </header>
      <div className="file-viewer-body" aria-busy={loading || undefined}>
        {loading && !result ? (
          <div className="file-viewer-state">
            <LoaderIcon size={20} className="animate-spin" />
            <p>{t('files.loading')}</p>
          </div>
        ) : error ? (
          <div className="file-viewer-state" role="alert">
            <AlertCircleIcon size={22} />
            <p>{failureMessage(error)}</p>
          </div>
        ) : result?.status === 'missing' ? (
          <div className="file-viewer-state">
            <AlertCircleIcon size={22} />
            <p>{t('files.missing')}</p>
            <code>{result.ref}</code>
          </div>
        ) : result?.status === 'outside' ? (
          <div className="file-viewer-state">
            <AlertCircleIcon size={22} />
            <p>{t('files.outside')}</p>
            <code>{result.path}</code>
          </div>
        ) : preview ? (
          <PreviewBody key={preview.path} preview={preview} mode={mode} />
        ) : null}
      </div>
    </section>
  )
}
