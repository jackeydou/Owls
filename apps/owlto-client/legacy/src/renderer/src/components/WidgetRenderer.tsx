import { getToolWidgetComponent } from '@renderer/components/tool-widgets/registry'
import type { ToolWidgetState } from '@renderer/components/tool-widgets/types'
import { motion, useReducedMotion } from 'motion/react'

function normalizeToolName(toolName: string): string {
  return toolName.toLowerCase().replace(/[-\s]+/g, '_')
}

function isAskUserWidget(toolName: string): boolean {
  const normalized = normalizeToolName(toolName)
  return (
    normalized === 'ask_user' || normalized === 'askuserinput' || normalized === 'ask_user_input'
  )
}

export function WidgetRenderer({ widget }: { widget: ToolWidgetState }): React.JSX.Element {
  const reduceMotion = useReducedMotion()
  const WidgetComponent = getToolWidgetComponent(widget.toolName)
  const isStreaming = widget.status === 'streaming' || widget.status === 'running'
  const isFormWidget = isAskUserWidget(widget.toolName)

  return (
    <motion.div
      layout={isFormWidget ? 'position' : true}
      initial={reduceMotion ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
    >
      <WidgetComponent widget={widget} expanded={false} isStreaming={isStreaming} />
    </motion.div>
  )
}
