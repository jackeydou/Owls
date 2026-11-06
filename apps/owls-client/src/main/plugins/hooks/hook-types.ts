export const AGENT_HOOK_EVENT_NAMES = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'Stop'
] as const

export type AgentHookEventName = (typeof AGENT_HOOK_EVENT_NAMES)[number]

export type AgentCommandHook = {
  type: 'command'
  command: string
  timeout?: number
  statusMessage?: string
}

export type AgentHookMatcherGroup = {
  matcher?: string
  hooks: AgentCommandHook[]
}

export type AgentHookConfig = {
  hooks?: Partial<Record<AgentHookEventName, AgentHookMatcherGroup[]>>
  managed_dir?: string
  windows_managed_dir?: string
  requirements?: string
}

export type PluginHookSource =
  | {
      type: 'path' | 'default-path'
      path: string
      index: number
    }
  | {
      type: 'inline'
      index: number
    }

export type PluginHookEventSummary = {
  event: AgentHookEventName
  matcherGroupCount: number
  commandCount: number
}

export type PluginHookDeclaration = {
  source: PluginHookSource
  config: AgentHookConfig
  events: PluginHookEventSummary[]
  matcherGroupCount: number
  commandCount: number
}
