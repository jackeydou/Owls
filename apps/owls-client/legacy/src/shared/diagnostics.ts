export type ChatDiagnosticEventName =
  | 'renderer_send_started'
  | 'renderer_send_queued'
  | 'renderer_new_session_created'
  | 'renderer_user_message_persisted'
  | 'renderer_agent_prompt_started'
  | 'renderer_agent_prompt_completed'
  | 'renderer_agent_prompt_failed'
  | 'agent_prompt_ipc_received'
  | 'agent_prompt_ipc_completed'
  | 'agent_prompt_ipc_failed'
  | 'agent_prompt_flow_started'
  | 'agent_session_resumed'
  | 'agent_runtime_resolved'
  | 'runtime_setup_started'
  | 'runtime_setup_completed'
  | 'runtime_setup_failed'
  | 'agent_run_created'
  | 'agent_run_started'
  | 'agent_run_finished'
  | 'agent_run_debug_started'
  | 'agent_run_debug_finished'
  | 'agent_hooks_started'
  | 'agent_hooks_completed'
  | 'agent_prompt_messages_prepared'
  | 'agent_prompt_returned'
  | 'agent_prompt_model_failed'
  | 'agent_prompt_failed'
  | 'agent_waiting_for_human_input'
  | 'agent_session_completed'
  | 'model_request_started'
  | 'model_request_finished'
  | 'diagnostics_exported'
  | 'diagnostics_export_file_skipped'

export type DiagnosticPrimitive = string | number | boolean | null

export type ChatDiagnosticDetails = Record<string, DiagnosticPrimitive | DiagnosticPrimitive[]>

export type ChatDiagnosticEventInput = {
  event: ChatDiagnosticEventName
  sessionId?: string | null
  runId?: string | null
  details?: ChatDiagnosticDetails
}

export type DiagnosticsExportResult = {
  exported: boolean
  path?: string
  includedFiles: string[]
}

export type DiagnosticsExportOptions = {
  includeDatabase?: boolean
}
