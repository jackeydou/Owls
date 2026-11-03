import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { copyTextToClipboard } from '@renderer/lib/clipboard'
import { useI18n } from '@renderer/lib/i18n'
import { Check, Copy, Download } from 'lucide-react'
import { type ComponentPropsWithoutRef, useCallback, useEffect, useRef, useState } from 'react'

type MarkdownTableProps = ComponentPropsWithoutRef<'table'> & {
  node?: unknown
}

function escapeDelimitedCell(value: string, delimiter: ',' | '\t'): string {
  if (delimiter === '\t') {
    return value.replace(/\t/g, ' ').replace(/\r?\n/g, ' ')
  }

  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim()
}

function serializeDelimitedTable(table: HTMLTableElement, delimiter: ',' | '\t'): string {
  return Array.from(table.querySelectorAll('tr'))
    .map((row) =>
      Array.from(row.querySelectorAll('th,td'))
        .map((cell) => escapeDelimitedCell(cell.textContent?.trim() ?? '', delimiter))
        .join(delimiter)
    )
    .join('\n')
}

function serializeMarkdownTable(table: HTMLTableElement): string {
  const rows = Array.from(table.querySelectorAll('tr')).map((row) =>
    Array.from(row.querySelectorAll('th,td')).map((cell) =>
      escapeMarkdownTableCell(cell.textContent ?? '')
    )
  )

  if (rows.length === 0) return ''

  const columnCount = Math.max(...rows.map((row) => row.length))
  const normalizeRow = (row: string[]) =>
    Array.from({ length: columnCount }, (_, index) => row[index] ?? '')
  const formatRow = (row: string[]) => `| ${normalizeRow(row).join(' | ')} |`
  const separator = `| ${Array.from({ length: columnCount }, () => '---').join(' | ')} |`
  const [header, ...body] = rows

  return [formatRow(header), separator, ...body.map(formatRow)].join('\n')
}

function downloadTextFile(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function MarkdownTable({
  children,
  className,
  node: _node,
  ...props
}: MarkdownTableProps): React.JSX.Element {
  const { t } = useI18n()
  const tableRef = useRef<HTMLTableElement>(null)
  const copyResetRef = useRef<number | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    return () => {
      if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current)
    }
  }, [])

  const handleCopy = useCallback(() => {
    const table = tableRef.current
    if (!table) return

    void copyTextToClipboard(serializeMarkdownTable(table))
      .then(() => {
        setCopied(true)
        if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current)
        copyResetRef.current = window.setTimeout(() => setCopied(false), 2000)
      })
      .catch((error) => {
        console.error('Failed to copy markdown table', error)
      })
  }, [])

  const handleDownload = useCallback(() => {
    const table = tableRef.current
    if (!table) return

    downloadTextFile(
      'table.csv',
      `\ufeff${serializeDelimitedTable(table, ',')}`,
      'text/csv;charset=utf-8'
    )
  }, [])

  return (
    <div className="pichu-markdown-table" data-streamdown="table-wrapper">
      <div className="pichu-markdown-table-actions">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={copied ? t('chat.markdownTable.copied') : t('chat.markdownTable.copy')}
              onClick={handleCopy}
            >
              {copied ? (
                <Check className="size-3.5" strokeWidth={1.9} />
              ) : (
                <Copy className="size-3.5" strokeWidth={1.9} />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={6}>
            {copied ? t('chat.markdownTable.copied') : t('chat.markdownTable.copy')}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t('chat.markdownTable.downloadCsv')}
              onClick={handleDownload}
            >
              <Download className="size-3.5" strokeWidth={1.9} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={6}>
            {t('chat.markdownTable.downloadCsv')}
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="pichu-markdown-table-scroller">
        <table ref={tableRef} className={className} data-streamdown="table" {...props}>
          {children}
        </table>
      </div>
    </div>
  )
}
