import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

export function DiffView({ diff }: { diff: string }) {
  const { t } = useTranslation()
  const lines = useMemo(() => {
    const occurrences = new Map<string, number>()
    return diff.split('\n').map((line) => {
      const occurrence = occurrences.get(line) ?? 0
      occurrences.set(line, occurrence + 1)
      return { line, key: `${line}\0${occurrence}` }
    })
  }, [diff])
  if (!diff) return <p className="router-panel-empty">{t('noChanges')}</p>
  return (
    <pre className="router-diff">
      {lines.map(({ line, key }) => (
        <div
          key={key}
          className={line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : ''}
        >
          {line || '\n'}
        </div>
      ))}
    </pre>
  )
}
