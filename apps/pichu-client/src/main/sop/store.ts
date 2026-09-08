import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, normalize, sep } from 'node:path'
import {
  LEGACY_SOP_GRAPH_SCHEMA,
  SOP_GRAPH_SCHEMA,
  SOP_INDEX_VERSION,
  type SopDetail,
  type SopEdge,
  type SopGraphDocument,
  type SopIndexEntry,
  type SopIndexFile,
  type SopNode,
  type SopNodeTracking
} from '../../shared/sop.js'
import { getDataRoot } from '../pichu-paths.js'

const MAX_SOP_JSON_BYTES = 2 * 1024 * 1024
const ISO_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

export type SaveSopResult = {
  sopId: string
  version: number
  sopPath: string
  indexPath: string
}

function nowIso(): string {
  return new Date().toISOString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`)
  }
  return value
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined
  return requireString(value, label)
}

function optionalIsoDateTime(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined
  return requireIsoDateTime(value, label)
}

function requireIsoDateTime(value: unknown, label: string): string {
  const dateTime = requireString(value, label)
  if (!ISO_DATE_TIME_PATTERN.test(dateTime) || Number.isNaN(Date.parse(dateTime))) {
    throw new Error(`${label} must be a valid ISO date-time string with timezone.`)
  }
  return dateTime
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`)
  }
  const strings = value.map((item, index) => requireString(item, `${label}[${index}]`))
  const seen = new Set<string>()
  for (const item of strings) {
    if (seen.has(item)) {
      throw new Error(`${label} contains duplicate value: ${item}`)
    }
    seen.add(item)
  }
  return strings
}

function assertSafeId(value: string, label: string): void {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) {
    throw new Error(`${label} must be lower snake case and start with a letter: ${value}`)
  }
}

function assertUnique(values: string[], label: string): void {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`${label} contains duplicate id: ${value}`)
    }
    seen.add(value)
  }
}

function normalizeTracking(value: unknown, label: string): SopNodeTracking {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`)
  }
  const status = value.status
  if (
    status !== 'pending' &&
    status !== 'running' &&
    status !== 'completed' &&
    status !== 'failed' &&
    status !== 'cancelled'
  ) {
    throw new Error(`${label}.status must be pending, running, completed, failed, or cancelled.`)
  }
  if (typeof value.is_delayed !== 'boolean') {
    throw new Error(`${label}.is_delayed must be a boolean.`)
  }
  return {
    status,
    is_delayed: value.is_delayed,
    delay_reason: optionalString(value.delay_reason, `${label}.delay_reason`),
    started_at: optionalIsoDateTime(value.started_at, `${label}.started_at`),
    completed_at: optionalIsoDateTime(value.completed_at, `${label}.completed_at`)
  }
}

function normalizeNode(value: unknown, index: number): SopNode {
  if (!isRecord(value)) {
    throw new Error(`nodes[${index}] must be an object.`)
  }

  const id = requireString(value.id, `nodes[${index}].id`)
  assertSafeId(id, `nodes[${index}].id`)
  const type = value.type
  const base = {
    id,
    title: requireString(value.title, `nodes[${index}].title`),
    description: optionalString(value.description, `nodes[${index}].description`),
    ddl: requireIsoDateTime(value.ddl, `nodes[${index}].ddl`),
    tracking: normalizeTracking(value.tracking, `nodes[${index}].tracking`),
    input_keys: requireStringArray(value.input_keys, `nodes[${index}].input_keys`),
    output_keys: requireStringArray(value.output_keys, `nodes[${index}].output_keys`)
  }

  if (type === 'agent') {
    if ('assignee_user_id' in value) {
      throw new Error(`Agent node ${id} must not include assignee_user_id.`)
    }
    return {
      ...base,
      type,
      agent_id: requireString(value.agent_id, `nodes[${index}].agent_id`),
      prompt: requireString(value.prompt, `nodes[${index}].prompt`)
    }
  }

  throw new Error(`nodes[${index}].type must be "agent".`)
}

function normalizeEdge(value: unknown, index: number): SopEdge {
  if (!isRecord(value)) {
    throw new Error(`edges[${index}] must be an object.`)
  }
  if (!isRecord(value.from) || !isRecord(value.to)) {
    throw new Error(`edges[${index}] must include from and to objects.`)
  }
  const id = requireString(value.id, `edges[${index}].id`)
  assertSafeId(id, `edges[${index}].id`)
  return {
    id,
    from: {
      node_id: requireString(value.from.node_id, `edges[${index}].from.node_id`),
      output_key: requireString(value.from.output_key, `edges[${index}].from.output_key`)
    },
    to: {
      node_id: requireString(value.to.node_id, `edges[${index}].to.node_id`),
      input_key: requireString(value.to.input_key, `edges[${index}].to.input_key`)
    }
  }
}

function validateSopGraph(value: unknown): SopGraphDocument {
  if (!isRecord(value)) {
    throw new Error('SOP graph JSON must be an object.')
  }
  if (value.$schema !== SOP_GRAPH_SCHEMA && value.$schema !== LEGACY_SOP_GRAPH_SCHEMA) {
    throw new Error(`SOP graph $schema must be "${SOP_GRAPH_SCHEMA}".`)
  }

  const sopId = requireString(value.sop_id, 'sop_id')
  assertSafeId(sopId, 'sop_id')
  const version = value.version
  if (typeof version !== 'number' || !Number.isInteger(version) || version <= 0) {
    throw new Error('version must be a positive integer.')
  }
  if (!Array.isArray(value.nodes) || value.nodes.length === 0) {
    throw new Error('nodes must be a non-empty array.')
  }
  if (!Array.isArray(value.edges)) {
    throw new Error('edges must be an array.')
  }

  const nodes = value.nodes.map(normalizeNode)
  const edges = value.edges.map(normalizeEdge)
  const nodeIds = nodes.map((node) => node.id)
  const edgeIds = edges.map((edge) => edge.id)
  assertUnique(nodeIds, 'nodes')
  assertUnique(edgeIds, 'edges')

  const nodeById = new Map(nodes.map((node, index) => [node.id, { node, index }]))
  const incoming = new Map(nodeIds.map((id) => [id, 0]))
  const outgoing = new Map(nodeIds.map((id) => [id, 0]))

  for (const edge of edges) {
    const from = nodeById.get(edge.from.node_id)
    const to = nodeById.get(edge.to.node_id)
    if (!from) {
      throw new Error(`Edge ${edge.id} references missing source node ${edge.from.node_id}.`)
    }
    if (!to) {
      throw new Error(`Edge ${edge.id} references missing target node ${edge.to.node_id}.`)
    }
    if (!from.node.output_keys.includes(edge.from.output_key)) {
      throw new Error(`Edge ${edge.id} references missing output key ${edge.from.output_key}.`)
    }
    if (!to.node.input_keys.includes(edge.to.input_key)) {
      throw new Error(`Edge ${edge.id} references missing input key ${edge.to.input_key}.`)
    }
    if (from.index >= to.index) {
      throw new Error(`Edge ${edge.id} violates topological node order.`)
    }
    incoming.set(edge.to.node_id, (incoming.get(edge.to.node_id) ?? 0) + 1)
    outgoing.set(edge.from.node_id, (outgoing.get(edge.from.node_id) ?? 0) + 1)
  }

  const entryNodeIds = requireStringArray(value.entry_node_ids, 'entry_node_ids')
  const terminalNodeIds = requireStringArray(value.terminal_node_ids, 'terminal_node_ids')
  if (entryNodeIds.length === 0) {
    throw new Error('entry_node_ids must be a non-empty array.')
  }
  if (terminalNodeIds.length === 0) {
    throw new Error('terminal_node_ids must be a non-empty array.')
  }
  for (const nodeId of entryNodeIds) {
    if (!nodeById.has(nodeId)) throw new Error(`entry_node_ids references missing node ${nodeId}.`)
    if ((incoming.get(nodeId) ?? 0) > 0) {
      throw new Error(`Entry node ${nodeId} must not have incoming edges.`)
    }
  }
  for (const nodeId of terminalNodeIds) {
    if (!nodeById.has(nodeId))
      throw new Error(`terminal_node_ids references missing node ${nodeId}.`)
    if ((outgoing.get(nodeId) ?? 0) > 0) {
      throw new Error(`Terminal node ${nodeId} must not have outgoing edges.`)
    }
  }

  return {
    $schema: SOP_GRAPH_SCHEMA,
    sop_id: sopId,
    name: requireString(value.name, 'name'),
    description: optionalString(value.description, 'description'),
    version,
    entry_node_ids: entryNodeIds,
    terminal_node_ids: terminalNodeIds,
    nodes,
    edges
  }
}

function sopRoot(dataRoot = getDataRoot()): string {
  return join(dataRoot, 'sop')
}

function sopIndexPath(dataRoot = getDataRoot()): string {
  return join(sopRoot(dataRoot), 'index.json')
}

function sopFileName(sopId: string): string {
  assertSafeId(sopId, 'sop_id')
  return `${sopId}.json`
}

function sopFilePath(sopId: string, dataRoot = getDataRoot()): string {
  return join(sopRoot(dataRoot), sopFileName(sopId))
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return false
    }
    throw error
  }
}

async function assertNotSymlinkAsync(path: string, label: string): Promise<void> {
  try {
    const stats = await lstat(path)
    if (stats.isSymbolicLink()) {
      throw new Error(`${label} must not be a symlink: ${path}`)
    }
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return
    }
    throw error
  }
}

function isPathInside(parent: string, child: string): boolean {
  const normalizedParent = normalize(parent)
  const normalizedChild = normalize(child)
  if (normalizedParent === sep) {
    return isAbsolute(normalizedChild)
  }
  return (
    normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}${sep}`)
  )
}

async function writeTextAtomic(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmpPath = `${path}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  await writeFile(tmpPath, value, 'utf8')
  await rename(tmpPath, path)
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeTextAtomic(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function readSopIndex(path: string): Promise<SopIndexFile> {
  if (!(await pathExists(path))) {
    return { version: SOP_INDEX_VERSION, sops: [] }
  }
  const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
  if (!isRecord(parsed) || parsed.version !== SOP_INDEX_VERSION || !Array.isArray(parsed.sops)) {
    throw new Error('SOP index.json is invalid.')
  }
  return parsed as SopIndexFile
}

function upsertSopIndexEntry(index: SopIndexFile, graph: SopGraphDocument): SopIndexFile {
  const now = nowIso()
  const existing = index.sops.find((entry) => entry.sop_id === graph.sop_id)
  const entry: SopIndexEntry = {
    sop_id: graph.sop_id,
    name: graph.name,
    description: graph.description ?? '',
    version: graph.version,
    file_path: sopFileName(graph.sop_id),
    created_at: existing?.created_at ?? now,
    updated_at: now
  }
  return {
    version: SOP_INDEX_VERSION,
    sops: [...index.sops.filter((item) => item.sop_id !== graph.sop_id), entry].sort((a, b) =>
      a.sop_id.localeCompare(b.sop_id)
    )
  }
}

function normalizeSopId(value: unknown): string {
  const sopId = requireString(value, 'sop_id')
  assertSafeId(sopId, 'sop_id')
  return sopId
}

async function readSopGraphFile(sopId: string): Promise<SopGraphDocument> {
  const raw = await readFile(sopFilePath(sopId), 'utf8')
  const graph = validateSopGraph(JSON.parse(raw) as unknown)
  if (graph.sop_id !== sopId) {
    throw new Error(`SOP graph file id mismatch: expected ${sopId}, found ${graph.sop_id}.`)
  }
  return graph
}

export async function listSavedSopsAsync(): Promise<SopIndexEntry[]> {
  const index = await readSopIndex(sopIndexPath())
  return [...index.sops].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}

export async function getSavedSopAsync(rawSopId: unknown): Promise<SopDetail | null> {
  const sopId = normalizeSopId(rawSopId)
  const index = await readSopIndex(sopIndexPath())
  const entry = index.sops.find((item) => item.sop_id === sopId)
  if (!entry) return null
  return {
    entry,
    graph: await readSopGraphFile(sopId)
  }
}

export async function saveSopFromJsonPathAsync(sopJsonPath: string): Promise<SaveSopResult> {
  const sourcePath = await realpath(sopJsonPath)
  await assertNotSymlinkAsync(sourcePath, 'SOP graph source JSON')
  const sourceStat = await stat(sourcePath)
  if (!sourceStat.isFile()) {
    throw new Error('sopJsonPath must point to a JSON file.')
  }
  if (sourceStat.size > MAX_SOP_JSON_BYTES) {
    throw new Error('SOP graph JSON file is too large.')
  }
  if (basename(sourcePath).toLowerCase().endsWith('.json') === false) {
    throw new Error('sopJsonPath must point to a .json file.')
  }

  const raw = await readFile(sourcePath, 'utf8')
  const graph = validateSopGraph(JSON.parse(raw) as unknown)
  const root = sopRoot()
  await mkdir(root, { recursive: true })
  await assertNotSymlinkAsync(root, 'SOP data root')
  if (!isPathInside(await realpath(getDataRoot()), await realpath(root))) {
    throw new Error('SOP data root escapes Owls data root.')
  }

  const destinationPath = sopFilePath(graph.sop_id)
  await writeTextAtomic(destinationPath, raw.endsWith('\n') ? raw : `${raw}\n`)

  const indexPath = sopIndexPath()
  const index = await readSopIndex(indexPath)
  await writeJsonAtomic(indexPath, upsertSopIndexEntry(index, graph))

  return {
    sopId: graph.sop_id,
    version: graph.version,
    sopPath: destinationPath,
    indexPath
  }
}
