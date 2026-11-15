import { IconButton } from '@renderer/components/ui/icon-button'
import { CheckIcon, CopyIcon, FileCodeIcon, NetworkIcon } from '@renderer/components/ui/icons'
import { mountAsync } from 'pele/lazy'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CustomRenderer, CustomRendererProps } from 'streamdown'
import './mermaid.css'

type DiagramState = { kind: 'drawing' } | { kind: 'drawn' } | { kind: 'failed'; reason: string }

/** Matches the message text size, so diagram labels read like the reply around them. */
const DIAGRAM_FONT_SIZE = 14

/**
 * Draws ```mermaid fences in agent Markdown with Pele. A fence still streaming in shows
 * its code, so half a diagram never flickers through parse errors; a diagram Pele
 * cannot draw keeps showing the code with a one-line reason.
 */
function MermaidDiagram({ code, isIncomplete }: CustomRendererProps) {
  if (isIncomplete)
    return (
      <DiagramFrame code={code} status={<DrawingHint />}>
        <DiagramSource code={code} />
      </DiagramFrame>
    )
  return <DrawnDiagram key={code} code={code} />
}

function DrawnDiagram({ code }: { code: string }) {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const [state, setState] = useState<DiagramState>({ kind: 'drawing' })
  const [showSource, setShowSource] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    let destroy: (() => void) | undefined
    mountAsync(canvas, code, {
      fontSize: DIAGRAM_FONT_SIZE,
      zoom: {
        labels: {
          zoomIn: t('mermaid.zoomIn'),
          zoomOut: t('mermaid.zoomOut'),
          reset: t('mermaid.zoomReset')
        }
      }
    }).then(
      (mounted) => {
        destroy = () => mounted.destroy()
        if (cancelled) return destroy()
        setState(
          mounted.error === undefined
            ? { kind: 'drawn' }
            : { kind: 'failed', reason: failureReason(mounted.error) }
        )
      },
      (error: unknown) => {
        if (!cancelled) setState({ kind: 'failed', reason: failureReason(error) })
      }
    )
    return () => {
      cancelled = true
      destroy?.()
    }
  }, [code, t])

  const failed = state.kind === 'failed'
  const sourceVisible = failed || showSource
  return (
    <DiagramFrame
      code={code}
      state={state.kind}
      toggle={
        failed ? null : (
          <IconButton
            size="sm"
            label={t(showSource ? 'mermaid.showDiagram' : 'mermaid.showCode')}
            tooltip={t(showSource ? 'mermaid.showDiagram' : 'mermaid.showCode')}
            aria-pressed={showSource}
            icon={showSource ? <NetworkIcon size={14} /> : <FileCodeIcon size={14} />}
            onClick={() => setShowSource((value) => !value)}
          />
        )
      }
    >
      {/* The canvas stays mounted behind the code, so switching back needs no redraw. */}
      <div ref={canvasRef} className="owlto-mermaid-canvas" hidden={sourceVisible} />
      {sourceVisible ? <DiagramSource code={code} /> : null}
      {failed ? (
        <div className="owlto-mermaid-error">
          <p>{t('mermaid.failed')}</p>
          <pre>{state.reason}</pre>
        </div>
      ) : null}
    </DiagramFrame>
  )
}

function DiagramFrame({
  code,
  state = 'streaming',
  status,
  toggle,
  children
}: {
  code: string
  state?: DiagramState['kind'] | 'streaming'
  status?: ReactNode
  toggle?: ReactNode
  children: ReactNode
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  return (
    <figure className="owlto-mermaid" data-state={state}>
      <div className="owlto-mermaid-header">
        <span className="owlto-mermaid-label">
          {t('mermaid.label')}
          {status}
        </span>
        <div className="owlto-mermaid-actions">
          {toggle}
          {state === 'streaming' ? null : (
            <IconButton
              size="sm"
              label={t(copied ? 'copied' : 'copy')}
              tooltip={t(copied ? 'copied' : 'copy')}
              icon={copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
              onClick={() => {
                void navigator.clipboard.writeText(code).then(() => setCopied(true))
              }}
            />
          )}
        </div>
      </div>
      {children}
    </figure>
  )
}

function DrawingHint() {
  const { t } = useTranslation()
  return <span className="owlto-mermaid-status">{t('mermaid.streaming')}</span>
}

function DiagramSource({ code }: { code: string }) {
  return (
    <pre className="owlto-mermaid-source">
      <code>{code}</code>
    </pre>
  )
}

/** Pele messages quote the diagram, so they are only ever shown as text, and capped. */
const MAX_REASON_LENGTH = 600
function failureReason(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error)).trimEnd()
  return message.length > MAX_REASON_LENGTH ? `${message.slice(0, MAX_REASON_LENGTH)}…` : message
}

export const mermaidRenderer: CustomRenderer = {
  language: 'mermaid',
  component: MermaidDiagram
}
