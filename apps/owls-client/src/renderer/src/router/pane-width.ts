import type { ResizeHandleProps } from '@renderer/components/ui/resize-handle'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { paneWidthBounds, type ResizablePane } from '../../../shared/codex'
import { paneWidthKey, useCodexStore } from '../codex/store'

/**
 * A pane's live width and the props for its resize handle. The drag previews locally and
 * persists once, when it ends, so moving the pointer never writes settings.
 */
export function usePaneWidth(
  pane: ResizablePane,
  edge: ResizeHandleProps['edge']
): { width: number; handle: ResizeHandleProps } {
  const { t } = useTranslation()
  const stored = useCodexStore((s) => s.settings.layout[paneWidthKey[pane]])
  const setPaneWidth = useCodexStore((s) => s.setPaneWidth)
  const [draft, setDraft] = useState<number | null>(null)
  const width = draft ?? stored
  const { min, max, initial } = paneWidthBounds[pane]
  return {
    width,
    handle: {
      edge,
      label: t(`pane.resize.${pane}`),
      width,
      min,
      max,
      initial,
      onPreview: setDraft,
      onCommit: (next) => {
        setPaneWidth(pane, next)
        setDraft(null)
      }
    }
  }
}
