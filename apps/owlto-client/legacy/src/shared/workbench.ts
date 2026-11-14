import type { JsonRenderDocument } from './json-render.js'

export const WORKBENCH_CELL_RENDERERS = ['json-render', 'automation'] as const
export type WorkbenchCellRenderer = (typeof WORKBENCH_CELL_RENDERERS)[number]

export type WorkbenchCellLayout = {
  x: number
  y: number
  w: number
  h: number
}

export type WorkbenchWorkspace = {
  id: string
  name: string
  description?: string
  created_at: string
  updated_at: string
}

export type WorkbenchUiSnapshot = {
  spec: unknown
  state?: Record<string, unknown>
}

// --- Save inputs (tagged by renderer) -------------------------------------

export type SaveJsonRenderCellInput = {
  renderer: 'json-render'
  cell_ui_json: JsonRenderDocument | string
  detailed_ui_json?: JsonRenderDocument | string
}

export type SaveAutomationCellInput = {
  renderer: 'automation'
  job_id: string
}

export type SaveWorkbenchCellInput = SaveJsonRenderCellInput | SaveAutomationCellInput

export type SaveToWorkbenchInput = {
  workspace_id?: string
  id?: string
  cell: SaveWorkbenchCellInput
}

export type SaveToWorkbenchResult = {
  cell: WorkbenchCellSummary
}

// --- Resolved card views (returned to the home grid) ----------------------

export type WorkbenchJsonRenderCardView = {
  renderer: 'json-render'
  cell_ui_json: JsonRenderDocument
}

export type WorkbenchAutomationCardView = {
  renderer: 'automation'
  job_id: string
  name: string | null
  schedule: string | null
  prompt: string | null
  active: boolean
  lastRunAt: string | null
  lastRunStatus: 'running' | 'success' | 'error' | null
}

export type WorkbenchCellCardView = WorkbenchJsonRenderCardView | WorkbenchAutomationCardView

// --- Resolved full views (returned to the detail surface) -----------------

export type WorkbenchJsonRenderCellView = WorkbenchJsonRenderCardView & {
  detailed_ui_json?: JsonRenderDocument
}

export type WorkbenchAutomationCellView = WorkbenchAutomationCardView

export type WorkbenchCellView = WorkbenchJsonRenderCellView | WorkbenchAutomationCellView

// --- Cell shapes returned across IPC --------------------------------------

export type WorkbenchCell = {
  id: string
  workspace_id: string
  cell_ui_tree_text: string
  cell: WorkbenchCellView
  has_detail: boolean
  can_run: boolean
  layout: WorkbenchCellLayout
  layout_updated_at?: string
  created_at: string
  updated_at: string
}

export type WorkbenchCellSummary = {
  id: string
  workspace_id: string
  cell_ui_tree_text: string
  cell: WorkbenchCellCardView
  has_detail: boolean
  can_run: boolean
  layout: WorkbenchCellLayout
  layout_updated_at?: string
  updated_at: string
}

// --- Persistence manifests ------------------------------------------------

export type WorkbenchUiFileRef = {
  path: string
  storage: 'external' | 'managed'
  size_bytes?: number
  sha256?: string
}

export type WorkbenchJsonRenderCellManifest = {
  renderer: 'json-render'
  cell_ui_ref: WorkbenchUiFileRef
  detailed_ui_ref?: WorkbenchUiFileRef
}

export type WorkbenchAutomationCellManifest = {
  renderer: 'automation'
  job_id: string
}

export type WorkbenchCellContentManifest =
  | WorkbenchJsonRenderCellManifest
  | WorkbenchAutomationCellManifest

export type WorkbenchCellManifest = {
  id: string
  workspace_id: string
  cell_ui_tree_text: string
  cell: WorkbenchCellContentManifest
  layout: WorkbenchCellLayout
  layout_updated_at?: string
  created_at: string
  updated_at: string
}

export type WorkbenchWorkspaceIndexFile = {
  version: 1
  current_workspace_id: string
  workspaces: WorkbenchWorkspace[]
}

export type WorkbenchFile = {
  version: 1
  workspace: WorkbenchWorkspace
  cells: WorkbenchCellManifest[]
}

// --- API inputs/results ---------------------------------------------------

export type CreateWorkbenchWorkspaceInput = {
  name: string
  description?: string
}

export type CreateWorkbenchWorkspaceResult = {
  workspace: WorkbenchWorkspace
}

export type ListWorkbenchWorkspacesResult = {
  workspaces: WorkbenchWorkspace[]
  current_workspace_id: string
}

export type ListWorkbenchInput = {
  workspace_id?: string
  limit?: number
  cursor?: string
}

export type ListWorkbenchResult = {
  cells: WorkbenchCellSummary[]
  next_cursor?: string
}

export type SetCurrentWorkbenchWorkspaceInput = {
  workspace_id: string
}

export type GetWorkbenchCellInput = {
  workspace_id?: string
  id: string
}

export type GetWorkbenchCellResult = {
  cell: WorkbenchCell
}

export type DeleteWorkbenchCellInput = {
  workspace_id?: string
  id: string
}

export type DeleteWorkbenchCellResult = {
  deleted: boolean
}

export type UpdateWorkbenchLayoutInput = {
  workspace_id?: string
  cells: Array<{
    id: string
    layout: WorkbenchCellLayout
  }>
}

export type RunWorkbenchCellInput = {
  workspace_id?: string
  id: string
}

export type RunWorkbenchCellResult = {
  status: 'started'
  instance_id: string
}
