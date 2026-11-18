import { type ComponentProps, createContext, type ReactNode, useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { type FileBase, looksLikeFilePath } from '../../../shared/file-preview'
import { useFilesStore } from './store'

/**
 * Where a relative path in the Markdown being rendered is looked up. Without a provider
 * a relative path is only found when it is absolute or under `~`.
 */
export const FileBaseContext = createContext<FileBase>({ kind: 'none' })

/** A local file named in agent output; a click shows it in the right sidebar's viewer. */
export function FileLink({
  path,
  className,
  children
}: {
  path: string
  className?: string
  children: ReactNode
}) {
  const { t } = useTranslation()
  const base = useContext(FileBaseContext)
  const openFile = useFilesStore((s) => s.openFile)
  return (
    <button
      type="button"
      className={className ?? 'owlto-file-link'}
      aria-label={t('files.openLabel', { path })}
      onClick={() => openFile({ ref: path, base })}
    >
      {children}
    </button>
  )
}

/** Inline code that reads as a file path, such as `src/main/app/ipc.ts:134`, becomes a FileLink. */
export function InlineFileCode({ children, className, node: _node, ...rest }: InlineCodeProps) {
  const text = typeof children === 'string' ? children : null
  if (text === null || !looksLikeFilePath(text))
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    )
  return (
    <FileLink path={text} className="owlto-file-code">
      <code className={className}>{text}</code>
    </FileLink>
  )
}
type InlineCodeProps = ComponentProps<'code'> & { node?: unknown }
