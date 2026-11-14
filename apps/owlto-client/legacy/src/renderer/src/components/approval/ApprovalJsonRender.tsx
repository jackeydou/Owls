import { JsonRender } from '@renderer/components/json-render'
import type { JsonRenderDocument } from '../../../../shared/json-render'
import type { ToolApprovalParsedCommand } from '../../../../shared/tool-approval'
import { JsonTreeView } from '../json-render/shared'

type ApprovalJsonRenderProps = {
  spec: unknown
  state?: Record<string, unknown>
  toolName: string
  cwd: string
  toolInput: unknown
  parsedCommand?: ToolApprovalParsedCommand
}

export function ApprovalJsonRender({
  spec,
  state,
  toolName,
  cwd,
  toolInput,
  parsedCommand
}: ApprovalJsonRenderProps): React.JSX.Element {
  const document = {
    renderer: 'json-render',
    spec
  } satisfies JsonRenderDocument
  const initialState = {
    ...(state ?? {}),
    toolName,
    cwd,
    toolInput,
    args: toolInput,
    ...(parsedCommand ? { parsedCommand } : {})
  }

  return (
    <JsonRender
      document={document}
      initialState={initialState}
      renderFallback={({ issue }) => (
        <div className="space-y-2 rounded-lg border border-amber-500/25 bg-amber-500/8 p-2.5">
          <p className="text-[12px] leading-5 text-amber-700 dark:text-amber-300">{issue}</p>
          <JsonTreeView value={toolInput} depth={0} defaultExpandedDepth={1} />
        </div>
      )}
    />
  )
}
