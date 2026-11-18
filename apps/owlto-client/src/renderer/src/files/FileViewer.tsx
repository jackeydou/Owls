import { IconButton } from '@renderer/components/ui/icon-button'
import {
  AlertCircleIcon,
  EllipsisIcon,
  FileIcon,
  FolderIcon,
  LoaderIcon,
  XIcon
} from '@renderer/components/ui/icons'
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger
} from '@renderer/components/ui/menu'
import { code } from '@streamdown/code'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Streamdown } from 'streamdown'
import type { FilePreview } from '../../../shared/file-preview'
import type { OpenInApp } from '../../../shared/open-in'
import { failureMessage } from '../app/failures'
import { markdownLinkComponents } from '../app/MarkdownLink'
import { mermaidRenderer } from '../app/MermaidDiagram'
import { useAppStore } from '../app/store'
import { useRouterStore } from '../router/store'
import { CodeView } from './CodeView'
import { FileBaseContext } from './FileLink'
import { markdownRemarkPlugins } from './remark-file-links'
import { type FileTab, useFilesStore } from './store'
import './files.css'

const plugins = { code, renderers: [mermaidRenderer] }
const MARKDOWN = /\.(md|mdx|markdown)$/i

const tabName = (tab: FileTab) =>
  tab.preview?.status === 'ok'
    ? tab.preview.preview.name
    : (tab.target.ref.split(/[\\/]/).filter(Boolean).at(-1) ?? tab.target.ref)

/** The open files, editor style: the active one is filled, each closes with its X. */
function FileTabs({ tabs, activeId }: { tabs: FileTab[]; activeId: number | null }) {
  const { t } = useTranslation()
  const activate = useFilesStore((s) => s.activate)
  const close = useFilesStore((s) => s.close)
  return (
    <div className="file-viewer-tabs" role="tablist" aria-label={t('router.panel.files')}>
      {tabs.map((tab) => {
        const name = tabName(tab)
        return (
          <div
            key={tab.id}
            className="file-viewer-tab"
            data-active={tab.id === activeId || undefined}
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab.id === activeId}
              onClick={() => activate(tab.id)}
            >
              {name}
            </button>
            <IconButton
              size="sm"
              className="file-viewer-tab-close"
              label={t('files.close', { name })}
              icon={<XIcon size={13} />}
              onClick={() => close(tab.id)}
            />
          </div>
        )
      })}
    </div>
  )
}

/** Editors first, then Finder; terminals are left out, a file is not something to run there. */
const fileApps = (apps: OpenInApp[]) => apps.filter((app) => app.kind !== 'terminal')

/** Everything the viewer can do with the file, behind one button. */
function FileMenu({
  preview,
  markdown,
  source,
  onToggleSource
}: {
  preview: FilePreview
  markdown: boolean
  source: boolean
  onToggleSource(): void
}) {
  const { t } = useTranslation()
  const apps = useRouterStore((s) => s.openInApps)
  const loadOpenInApps = useRouterStore((s) => s.loadOpenInApps)
  const openFileIn = useRouterStore((s) => s.openFileIn)
  const reload = useFilesStore((s) => s.reload)
  const settings = useAppStore((s) => s.settings)
  const saveSettings = useAppStore((s) => s.saveSettings)
  useEffect(() => {
    if (apps === null) void loadOpenInApps()
  }, [apps, loadOpenInApps])
  const choices = fileApps(apps ?? [])
  const open = (app: OpenInApp) => {
    if (app.kind === 'editor' && app.id !== settings.openInApp)
      void saveSettings({ ...settings, openInApp: app.id })
    // The app coming forward is the result; a failure shows as the router's error toast.
    void openFileIn({ path: preview.path, appId: app.id })
  }
  return (
    <Menu
      onOpenChange={(next) => {
        // Picks up an app installed while Owlto was running; main rescans at most once a minute.
        if (next) void loadOpenInApps()
      }}
    >
      <MenuTrigger asChild>
        <IconButton
          size="sm"
          label={t('files.more')}
          tooltip={t('files.more')}
          tooltipSide="bottom"
          icon={<EllipsisIcon size={16} />}
        />
      </MenuTrigger>
      <MenuContent align="end" className="min-w-[200px]">
        {choices.length ? (
          <MenuGroup>
            <MenuLabel>{t('openIn.menuLabel')}</MenuLabel>
            {choices.map((app) => (
              <MenuItem key={app.id} onSelect={() => open(app)}>
                {app.icon ? (
                  <img src={app.icon} alt="" width={16} height={16} draggable={false} />
                ) : (
                  <span className="open-in-letter" style={{ width: 16, height: 16 }} aria-hidden>
                    {app.name.slice(0, 1)}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate">
                  {app.kind === 'files' ? t('files.reveal', { app: app.name }) : app.name}
                </span>
              </MenuItem>
            ))}
          </MenuGroup>
        ) : null}
        {choices.length ? <MenuSeparator /> : null}
        {markdown ? (
          <MenuItem onSelect={onToggleSource}>
            {t(source ? 'files.showPreview' : 'files.showSource')}
          </MenuItem>
        ) : null}
        <MenuItem onSelect={() => void navigator.clipboard.writeText(preview.path)}>
          {t('files.copyPath')}
        </MenuItem>
        <MenuItem onSelect={() => void reload()}>{t('files.reload')}</MenuItem>
      </MenuContent>
    </Menu>
  )
}

/** The path under its project, folder by folder, like an editor's breadcrumb. */
function Breadcrumb({ label }: { label: string }) {
  const parts = label.split('/').filter(Boolean)
  return (
    <div className="file-viewer-crumbs">
      {parts.map((part, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: path segments are positional
        <span key={index}>
          {index > 0 ? <i aria-hidden>/</i> : null}
          {part}
        </span>
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

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function PreviewBody({ preview, source }: { preview: FilePreview; source: boolean }) {
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
      {MARKDOWN.test(preview.name) && !source ? (
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

function TabBody({ tab, source }: { tab: FileTab; source: boolean }) {
  const { t } = useTranslation()
  const result = tab.preview
  if (tab.loading && !result)
    return (
      <div className="file-viewer-state">
        <LoaderIcon size={20} className="animate-spin" />
        <p>{t('files.loading')}</p>
      </div>
    )
  if (tab.error)
    return (
      <div className="file-viewer-state" role="alert">
        <AlertCircleIcon size={22} />
        <p>{failureMessage(tab.error)}</p>
      </div>
    )
  if (result?.status === 'missing' || result?.status === 'outside')
    return (
      <div className="file-viewer-state">
        <AlertCircleIcon size={22} />
        <p>{t(result.status === 'missing' ? 'files.missing' : 'files.outside')}</p>
        <code>{result.status === 'missing' ? result.ref : result.path}</code>
      </div>
    )
  return result ? (
    <PreviewBody key={result.preview.path} preview={result.preview} source={source} />
  ) : null
}

/** The right sidebar's file viewer: open files as tabs, the active one under its path. */
export function FileViewerPane() {
  const { t } = useTranslation()
  const tabs = useFilesStore((s) => s.tabs)
  const activeId = useFilesStore((s) => s.activeId)
  const [sourceIds, setSourceIds] = useState<ReadonlySet<number>>(new Set())
  const tab = tabs.find((t) => t.id === activeId) ?? null

  if (!tab)
    return (
      <section className="router-right-pane file-viewer" aria-label={t('router.panel.files')}>
        <div className="file-viewer-state">
          <FileIcon size={22} />
          <p>{t('files.empty')}</p>
        </div>
      </section>
    )

  const preview = tab.preview?.status === 'ok' ? tab.preview.preview : null
  const markdown = preview?.body.kind === 'text' && MARKDOWN.test(preview.name)
  const source = sourceIds.has(tab.id)
  return (
    <section className="router-right-pane file-viewer" aria-label={t('router.panel.files')}>
      <FileTabs tabs={tabs} activeId={activeId} />
      <div className="file-viewer-path">
        <Breadcrumb label={preview?.label ?? tab.target.ref} />
        {preview ? (
          <FileMenu
            preview={preview}
            markdown={markdown}
            source={source}
            onToggleSource={() =>
              setSourceIds((ids) => {
                const next = new Set(ids)
                if (!next.delete(tab.id)) next.add(tab.id)
                return next
              })
            }
          />
        ) : null}
      </div>
      <div className="file-viewer-body" role="tabpanel" aria-busy={tab.loading || undefined}>
        <TabBody key={tab.id} tab={tab} source={source} />
      </div>
    </section>
  )
}
