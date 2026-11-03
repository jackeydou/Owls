export const SOP_GRAPH_SCHEMA = 'pichu.sop_graph.v1' as const
export const LEGACY_SOP_GRAPH_SCHEMA = 'pix.sop_graph.v1' as const
export const SOP_INDEX_VERSION = 1 as const

export type SopNodeStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export type SopNodeTracking = {
  status: SopNodeStatus
  is_delayed: boolean
  delay_reason?: string
  started_at?: string
  completed_at?: string
}

export type SopEdge = {
  id: string
  from: {
    node_id: string
    output_key: string
  }
  to: {
    node_id: string
    input_key: string
  }
}

type BaseSopNode = {
  id: string
  title: string
  description?: string
  ddl: string
  tracking: SopNodeTracking
  input_keys: string[]
  output_keys: string[]
}

export type AgentSopNode = BaseSopNode & {
  type: 'agent'
  agent_id: string
  prompt: string
}

export type SopNode = AgentSopNode

export type SopGraphDocument = {
  $schema: typeof SOP_GRAPH_SCHEMA
  sop_id: string
  name: string
  description?: string
  version: number
  entry_node_ids: string[]
  terminal_node_ids: string[]
  nodes: SopNode[]
  edges: SopEdge[]
}

export type SopIndexEntry = {
  sop_id: string
  name: string
  description: string
  version: number
  file_path: string
  created_at: string
  updated_at: string
}

export type SopIndexFile = {
  version: typeof SOP_INDEX_VERSION
  sops: SopIndexEntry[]
}

export type SopDetail = {
  entry: SopIndexEntry
  graph: SopGraphDocument
}
