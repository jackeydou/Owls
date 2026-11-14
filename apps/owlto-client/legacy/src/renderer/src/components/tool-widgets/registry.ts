import type { ComponentType } from 'react'
import { AskUserInputToolWidget } from './AskUserInputToolWidget'
import { DefaultToolWidget } from './DefaultToolWidget'
import { ImageGenerationToolWidget } from './ImageGenerationToolWidget'
import { PluginUseToolWidget } from './PluginUseToolWidget'
import { RunPluginCommandWidget } from './RunPluginCommandWidget'
import { ScreenshotToolWidget } from './ScreenshotToolWidget'
import { StreamingUIToolWidget } from './StreamingUIToolWidget'
import { SubAgentWidget } from './SubAgentWidget'
import type { ToolWidgetComponentProps } from './types'

const toolWidgetRegistry: Record<string, ComponentType<ToolWidgetComponentProps>> = {
  ask_user: AskUserInputToolWidget,
  askuserinput: AskUserInputToolWidget,
  ask_user_input: AskUserInputToolWidget,
  streamingUITool: StreamingUIToolWidget,
  executePluginScript: RunPluginCommandWidget,
  executePluginBinCommand: RunPluginCommandWidget,
  delegateToAgent: SubAgentWidget,
  image_generate: ImageGenerationToolWidget,
  embeddedBrowserStatus: PluginUseToolWidget,
  embeddedBrowserOpen: PluginUseToolWidget,
  embeddedBrowserSnapshot: PluginUseToolWidget,
  embeddedBrowserEval: PluginUseToolWidget,
  embeddedBrowserClick: PluginUseToolWidget,
  embeddedBrowserFill: PluginUseToolWidget,
  embeddedBrowserType: PluginUseToolWidget,
  embeddedBrowserPress: PluginUseToolWidget,
  embeddedBrowserScroll: PluginUseToolWidget,
  embeddedBrowserWait: PluginUseToolWidget,
  browserStatus: PluginUseToolWidget,
  browserOpen: PluginUseToolWidget,
  browserSnapshot: PluginUseToolWidget,
  browserClick: PluginUseToolWidget,
  browserFill: PluginUseToolWidget,
  browserSelect: PluginUseToolWidget,
  browserPickDate: PluginUseToolWidget,
  browserTreeSelect: PluginUseToolWidget,
  browserPress: PluginUseToolWidget,
  browserScroll: PluginUseToolWidget,
  browserScrollUntil: PluginUseToolWidget,
  browserWaitFor: PluginUseToolWidget,
  browserScreenshot: PluginUseToolWidget,
  browserDiagnostics: PluginUseToolWidget,
  computerEnsureApp: PluginUseToolWidget,
  listScreenSources: PluginUseToolWidget,
  captureDesktop: ScreenshotToolWidget,
  computerGetAppState: ScreenshotToolWidget,
  computerClick: PluginUseToolWidget,
  computerDrag: PluginUseToolWidget,
  computerType: PluginUseToolWidget,
  computerPressKey: PluginUseToolWidget
}

function normalizeToolName(toolName: string): string {
  return toolName.toLowerCase().replace(/[-\s]+/g, '_')
}

export function getToolWidgetComponent(toolName: string): ComponentType<ToolWidgetComponentProps> {
  return (
    toolWidgetRegistry[toolName] ??
    toolWidgetRegistry[normalizeToolName(toolName)] ??
    DefaultToolWidget
  )
}
