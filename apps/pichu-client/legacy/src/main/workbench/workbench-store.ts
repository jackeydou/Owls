import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path'
import {
  isJsonRenderDocument,
  isJsonRenderState,
  type JsonRenderDocument,
  type JsonRenderState,
  jsonRenderDocumentToTextTree
} from '../../shared/json-render.js'
import type {
  CreateWorkbenchWorkspaceInput,
  CreateWorkbenchWorkspaceResult,
  DeleteWorkbenchCellInput,
  DeleteWorkbenchCellResult,
  GetWorkbenchCellInput,
  GetWorkbenchCellResult,
  ListWorkbenchInput,
  ListWorkbenchResult,
  ListWorkbenchWorkspacesResult,
  RunWorkbenchCellInput,
  RunWorkbenchCellResult,
  SaveToWorkbenchInput,
  SaveToWorkbenchResult,
  SaveWorkbenchCellInput,
  SetCurrentWorkbenchWorkspaceInput,
  UpdateWorkbenchLayoutInput,
  WorkbenchAutomationCardView,
  WorkbenchAutomationCellManifest,
  WorkbenchCell,
  WorkbenchCellCardView,
  WorkbenchCellContentManifest,
  WorkbenchCellLayout,
  WorkbenchCellManifest,
  WorkbenchCellSummary,
  WorkbenchCellView,
  WorkbenchFile,
  WorkbenchUiFileRef,
  WorkbenchWorkspace,
  WorkbenchWorkspaceIndexFile
} from '../../shared/workbench.js'
import { listCronJobs } from '../cron/cron-scheduler.js'
import { getDataRoot } from '../pichu-paths.js'

const WORKBENCH_VERSION = 1
const DEFAULT_WORKSPACE_ID = 'main'
const DEFAULT_WORKSPACE_NAME = 'Personal'
const GRID_COLUMNS = 24
const DEFAULT_LAYOUT: WorkbenchCellLayout = { x: 0, y: 0, w: 8, h: 9 }
const MAX_UI_JSON_BYTES = 2 * 1024 * 1024

type UiInput = JsonRenderDocument | string
type SaveOptions = {
  pathBase?: string
}

function nowIso(): string {
  return new Date().toISOString()
}

function workbenchRoot(): string {
  return join(getDataRoot(), 'workbench')
}

function workspaceIndexPath(): string {
  return join(workbenchRoot(), 'workspaces.json')
}

function workspaceDir(workspaceId: string): string {
  return join(workbenchRoot(), 'workspaces', workspaceId)
}

function workspaceFilePath(workspaceId: string): string {
  return join(workspaceDir(workspaceId), 'workbench.json')
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmpPath = `${path}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  await writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(tmpPath, path)
}

function safeWorkspaceId(): string {
  return `workspace-${randomUUID()}`
}

function safeCellId(): string {
  return `cell-${randomUUID()}`
}

function defaultWorkspace(createdAt = nowIso()): WorkbenchWorkspace {
  return {
    id: DEFAULT_WORKSPACE_ID,
    name: DEFAULT_WORKSPACE_NAME,
    created_at: createdAt,
    updated_at: createdAt
  }
}

function normalizeLimit(limit: unknown): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) return 100
  return Math.min(200, Math.floor(limit))
}

function validateLayout(layout: WorkbenchCellLayout): WorkbenchCellLayout {
  const values = [layout.x, layout.y, layout.w, layout.h]
  if (values.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new Error('Workbench layout values must be non-negative integers.')
  }
  if (layout.w < 1 || layout.h < 1) {
    throw new Error('Workbench layout width and height must be at least 1.')
  }
  return layout
}

function layoutsOverlap(left: WorkbenchCellLayout, right: WorkbenchCellLayout): boolean {
  return (
    left.x < right.x + right.w &&
    left.x + left.w > right.x &&
    left.y < right.y + right.h &&
    left.y + left.h > right.y
  )
}

function nextAvailableLayout(cells: WorkbenchCellManifest[]): WorkbenchCellLayout {
  const occupiedLayouts = cells.map((cell) => cell.layout)
  const maxY = occupiedLayouts.reduce((nextY, layout) => Math.max(nextY, layout.y + layout.h), 0)
  for (let y = 0; y <= maxY + DEFAULT_LAYOUT.h; y += 1) {
    for (let x = 0; x <= GRID_COLUMNS - DEFAULT_LAYOUT.w; x += 1) {
      const candidate = { ...DEFAULT_LAYOUT, x, y }
      if (!occupiedLayouts.some((layout) => layoutsOverlap(candidate, layout))) {
        return candidate
      }
    }
  }
  return { ...DEFAULT_LAYOUT, y: maxY }
}

function parseJsonDocument(raw: string, source: string): JsonRenderDocument {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Workbench UI JSON is not valid JSON (${source}): ${message}`)
  }
  if (!isJsonRenderDocument(parsed)) {
    throw new Error(`Workbench UI JSON is not a JsonRenderDocument (${source}).`)
  }
  return parsed
}

async function readJsonDocumentFile(path: string): Promise<JsonRenderDocument> {
  const fileStat = await stat(path)
  if (!fileStat.isFile()) {
    throw new Error('Workbench UI JSON path must point to a file.')
  }
  if (fileStat.size > MAX_UI_JSON_BYTES) {
    throw new Error('Workbench UI JSON file is too large.')
  }
  return parseJsonDocument(await readFile(path, 'utf8'), path)
}

async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

async function ensureWorkbenchIndex(): Promise<WorkbenchWorkspaceIndexFile> {
  await mkdir(workbenchRoot(), { recursive: true })
  const path = workspaceIndexPath()
  if (!(await pathExists(path))) {
    const workspace = defaultWorkspace()
    const index: WorkbenchWorkspaceIndexFile = {
      version: WORKBENCH_VERSION,
      current_workspace_id: workspace.id,
      workspaces: [workspace]
    }
    await writeJsonAtomic(path, index)
    await ensureWorkspaceFile(workspace)
    return index
  }
  const index = await readJsonFile<WorkbenchWorkspaceIndexFile>(path)
  if (!Array.isArray(index.workspaces) || index.workspaces.length === 0) {
    const workspace = defaultWorkspace()
    const repaired = {
      version: WORKBENCH_VERSION,
      current_workspace_id: workspace.id,
      workspaces: [workspace]
    } satisfies WorkbenchWorkspaceIndexFile
    await writeJsonAtomic(path, repaired)
    await ensureWorkspaceFile(workspace)
    return repaired
  }
  return index
}

async function saveWorkbenchIndex(index: WorkbenchWorkspaceIndexFile): Promise<void> {
  await writeJsonAtomic(workspaceIndexPath(), index)
}

async function setCurrentWorkspace(workspaceId: string): Promise<void> {
  const index = await ensureWorkbenchIndex()
  if (index.current_workspace_id === workspaceId) return
  if (!index.workspaces.some((workspace) => workspace.id === workspaceId)) {
    throw new Error('Workbench workspace not found.')
  }
  await saveWorkbenchIndex({ ...index, current_workspace_id: workspaceId })
}

async function ensureWorkspaceFile(workspace: WorkbenchWorkspace): Promise<WorkbenchFile> {
  const path = workspaceFilePath(workspace.id)
  if (await pathExists(path)) {
    const file = await readJsonFile<WorkbenchFile>(path)
    if (
      file.workspace.name !== workspace.name ||
      file.workspace.description !== workspace.description
    ) {
      const migrated = { ...file, workspace }
      await writeJsonAtomic(path, migrated)
      return migrated
    }
    return file
  }
  const file: WorkbenchFile = {
    version: WORKBENCH_VERSION,
    workspace,
    cells: []
  }
  await writeJsonAtomic(path, file)
  return file
}

async function loadWorkspaceFile(workspaceId?: string): Promise<WorkbenchFile> {
  const index = await ensureWorkbenchIndex()
  const id = workspaceId ?? index.current_workspace_id
  const workspace = index.workspaces.find((item) => item.id === id)
  if (!workspace) {
    throw new Error('Workbench workspace not found.')
  }
  return ensureWorkspaceFile(workspace)
}

async function saveWorkspaceFile(file: WorkbenchFile): Promise<void> {
  await writeJsonAtomic(workspaceFilePath(file.workspace.id), file)
  const index = await ensureWorkbenchIndex()
  const nextWorkspaces = index.workspaces.map((workspace) =>
    workspace.id === file.workspace.id ? file.workspace : workspace
  )
  await saveWorkbenchIndex({ ...index, workspaces: nextWorkspaces })
}

function resolveExternalPath(inputPath: string, pathBase?: string): string {
  const trimmed = inputPath.trim()
  if (!trimmed) throw new Error('Workbench UI JSON path must be non-empty.')
  return normalize(isAbsolute(trimmed) ? trimmed : resolve(pathBase ?? process.cwd(), trimmed))
}

async function uiRefFromInput(
  workspaceId: string,
  cellId: string,
  kind: 'cell' | 'detail',
  input: UiInput,
  options: SaveOptions
): Promise<{ ref: WorkbenchUiFileRef; document: JsonRenderDocument; baseDir: string }> {
  if (typeof input === 'string') {
    const path = resolveExternalPath(input, options.pathBase)
    const document = await readJsonDocumentFile(path)
    const fileStat = await stat(path)
    return {
      ref: {
        path,
        storage: 'external',
        size_bytes: fileStat.size,
        sha256: createHash('sha256')
          .update(await readFile(path))
          .digest('hex')
      },
      document: {
        ...document,
        state_source: await resolveJsonRenderState(document, dirname(path))
      },
      baseDir: dirname(path)
    }
  }
  if (!isJsonRenderDocument(input)) {
    throw new Error('Workbench UI JSON input must be a JsonRenderDocument.')
  }
  const relativePath = join('cells', cellId, `${kind}.json`)
  const absolutePath = join(workspaceDir(workspaceId), relativePath)
  await writeJsonAtomic(absolutePath, input)
  const bytes = Buffer.byteLength(JSON.stringify(input), 'utf8')
  return {
    ref: {
      path: relativePath,
      storage: 'managed',
      size_bytes: bytes,
      sha256: createHash('sha256').update(JSON.stringify(input)).digest('hex')
    },
    document: {
      ...input,
      state_source: await resolveJsonRenderState(input, dirname(absolutePath))
    },
    baseDir: dirname(absolutePath)
  }
}

function resolveUiRefPath(workspaceId: string, ref: WorkbenchUiFileRef): string {
  return ref.storage === 'managed' ? join(workspaceDir(workspaceId), ref.path) : normalize(ref.path)
}

async function resolveJsonRenderState(
  document: JsonRenderDocument,
  baseDir: string
): Promise<JsonRenderState> {
  const stateSource = document.state_source
  if (stateSource === undefined) return {}
  if (typeof stateSource !== 'string') {
    if (!isJsonRenderState(stateSource)) return {}
    return stateSource
  }
  const statePath = normalize(isAbsolute(stateSource) ? stateSource : resolve(baseDir, stateSource))
  try {
    const parsed = JSON.parse(await readFile(statePath, 'utf8')) as unknown
    return isJsonRenderState(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

async function readUiRef(
  workspaceId: string,
  ref: WorkbenchUiFileRef
): Promise<{ document: JsonRenderDocument; baseDir: string }> {
  const path = resolveUiRefPath(workspaceId, ref)
  const document = await readJsonDocumentFile(path)
  return {
    document: { ...document, state_source: await resolveJsonRenderState(document, dirname(path)) },
    baseDir: dirname(path)
  }
}

async function summarizeDocument(document: JsonRenderDocument, baseDir: string): Promise<string> {
  return jsonRenderDocumentToTextTree(document, await resolveJsonRenderState(document, baseDir))
}

function automationCardView(cell: WorkbenchAutomationCellManifest): WorkbenchAutomationCardView {
  const job = listCronJobs().find((item) => item.id === cell.job_id)
  return {
    renderer: 'automation',
    job_id: cell.job_id,
    name: job?.name ?? null,
    schedule: job?.schedule ?? null,
    prompt: job?.prompt ?? null,
    active: job?.active ?? false,
    lastRunAt: job?.lastRunAt ?? null,
    lastRunStatus: job?.lastRunStatus ?? null
  }
}

function automationTreeText(view: WorkbenchAutomationCardView): string {
  const lines = [`Automation task: ${view.name ?? view.job_id}`]
  if (view.prompt) lines.push(view.prompt)
  if (view.schedule) lines.push(`Schedule: ${view.schedule}`)
  return lines.join('\n')
}

function treeTextForView(
  view: WorkbenchCellCardView | WorkbenchCellView,
  fallbackText: string
): string {
  if (view.renderer === 'automation') {
    return automationTreeText(view)
  }
  return fallbackText
}

// --- Manifest <-> API shape -----------------------------------------------

async function toCardView(manifest: WorkbenchCellManifest): Promise<WorkbenchCellCardView> {
  if (manifest.cell.renderer === 'json-render') {
    const cellUi = await readUiRef(manifest.workspace_id, manifest.cell.cell_ui_ref)
    return { renderer: 'json-render', cell_ui_json: cellUi.document }
  }
  if (manifest.cell.renderer === 'automation') {
    return automationCardView(manifest.cell)
  }
  throw new Error('Unsupported Workbench cell renderer.')
}

function manifestHasDetail(manifest: WorkbenchCellManifest): boolean {
  if (manifest.cell.renderer === 'automation') return true
  return Boolean(manifest.cell.detailed_ui_ref)
}

function manifestCanRun(manifest: WorkbenchCellManifest): boolean {
  void manifest
  return false
}

async function toSummary(manifest: WorkbenchCellManifest): Promise<WorkbenchCellSummary> {
  const view = await toCardView(manifest)
  return {
    id: manifest.id,
    workspace_id: manifest.workspace_id,
    cell_ui_tree_text: treeTextForView(view, manifest.cell_ui_tree_text),
    cell: view,
    has_detail: manifestHasDetail(manifest),
    can_run: manifestCanRun(manifest),
    layout: manifest.layout,
    layout_updated_at: manifest.layout_updated_at,
    updated_at: manifest.updated_at
  }
}

async function manifestToCell(manifest: WorkbenchCellManifest): Promise<WorkbenchCell> {
  let view: WorkbenchCellView
  if (manifest.cell.renderer === 'json-render') {
    const cellUi = await readUiRef(manifest.workspace_id, manifest.cell.cell_ui_ref)
    const detailUi = manifest.cell.detailed_ui_ref
      ? await readUiRef(manifest.workspace_id, manifest.cell.detailed_ui_ref)
      : undefined
    view = {
      renderer: 'json-render',
      cell_ui_json: cellUi.document,
      detailed_ui_json: detailUi?.document
    }
  } else if (manifest.cell.renderer === 'automation') {
    view = automationCardView(manifest.cell)
  } else {
    throw new Error('Unsupported Workbench cell renderer.')
  }
  return {
    id: manifest.id,
    workspace_id: manifest.workspace_id,
    cell_ui_tree_text: treeTextForView(view, manifest.cell_ui_tree_text),
    cell: view,
    has_detail: manifestHasDetail(manifest),
    can_run: manifestCanRun(manifest),
    layout: manifest.layout,
    layout_updated_at: manifest.layout_updated_at,
    created_at: manifest.created_at,
    updated_at: manifest.updated_at
  }
}

async function removeManagedCellDir(workspaceId: string, cellId: string): Promise<void> {
  await rm(join(workspaceDir(workspaceId), 'cells', cellId), {
    recursive: true,
    force: true
  }).catch(() => {})
}

async function buildCellContent(
  workspaceId: string,
  cellId: string,
  input: SaveWorkbenchCellInput,
  existing: WorkbenchCellManifest | undefined,
  options: SaveOptions
): Promise<{ cell: WorkbenchCellContentManifest; treeText: string }> {
  if (input.renderer === 'json-render') {
    const cellUi = await uiRefFromInput(workspaceId, cellId, 'cell', input.cell_ui_json, options)
    const detailedUi =
      input.detailed_ui_json !== undefined
        ? await uiRefFromInput(workspaceId, cellId, 'detail', input.detailed_ui_json, options)
        : undefined
    return {
      cell: {
        renderer: 'json-render',
        cell_ui_ref: cellUi.ref,
        detailed_ui_ref: detailedUi?.ref
      },
      treeText: await summarizeDocument(cellUi.document, cellUi.baseDir)
    }
  }
  if (input.renderer === 'automation') {
    const jobId = input.job_id.trim()
    if (!jobId) throw new Error('Workbench automation cell requires a non-empty job_id.')
    const cell: WorkbenchAutomationCellManifest = {
      renderer: 'automation',
      job_id: jobId
    }
    return { cell, treeText: automationTreeText(automationCardView(cell)) }
  }
  void existing
  throw new Error('Unsupported Workbench cell renderer.')
}

// --- Public API -----------------------------------------------------------

export async function createWorkbenchWorkspace(
  input: CreateWorkbenchWorkspaceInput
): Promise<CreateWorkbenchWorkspaceResult> {
  const name = input.name.trim()
  if (!name) throw new Error('Workspace name is required.')
  const index = await ensureWorkbenchIndex()
  const timestamp = nowIso()
  const workspace: WorkbenchWorkspace = {
    id: safeWorkspaceId(),
    name,
    description: input.description?.trim() || undefined,
    created_at: timestamp,
    updated_at: timestamp
  }
  await ensureWorkspaceFile(workspace)
  await saveWorkbenchIndex({
    ...index,
    current_workspace_id: workspace.id,
    workspaces: [workspace, ...index.workspaces]
  })
  return { workspace }
}

export async function listWorkbenchWorkspaces(): Promise<ListWorkbenchWorkspacesResult> {
  const index = await ensureWorkbenchIndex()
  return {
    workspaces: index.workspaces,
    current_workspace_id: index.current_workspace_id
  }
}

export async function setCurrentWorkbenchWorkspace(
  input: SetCurrentWorkbenchWorkspaceInput
): Promise<void> {
  await setCurrentWorkspace(input.workspace_id)
}

export async function saveToWorkbench(
  input: SaveToWorkbenchInput,
  options: SaveOptions = {}
): Promise<SaveToWorkbenchResult> {
  const file = await loadWorkspaceFile(input.workspace_id)
  const timestamp = nowIso()
  const existing = input.id ? file.cells.find((cell) => cell.id === input.id) : undefined
  const cellId = existing?.id ?? input.id ?? safeCellId()
  const { cell, treeText } = await buildCellContent(
    file.workspace.id,
    cellId,
    input.cell,
    existing,
    options
  )
  // Switching a managed json-render cell to a non-json cell leaves orphaned files behind.
  if (
    existing?.cell.renderer === 'json-render' &&
    cell.renderer !== 'json-render' &&
    existing.cell.cell_ui_ref.storage === 'managed'
  ) {
    await removeManagedCellDir(file.workspace.id, cellId)
  }
  const manifest: WorkbenchCellManifest = {
    id: cellId,
    workspace_id: file.workspace.id,
    cell_ui_tree_text: treeText,
    cell,
    layout: existing?.layout ?? nextAvailableLayout(file.cells),
    layout_updated_at: existing?.layout_updated_at,
    created_at: existing?.created_at ?? timestamp,
    updated_at: timestamp
  }
  const cells = existing
    ? file.cells.map((entry) => (entry.id === existing.id ? manifest : entry))
    : [manifest, ...file.cells]
  await saveWorkspaceFile({
    ...file,
    workspace: { ...file.workspace, updated_at: timestamp },
    cells
  })
  return { cell: await toSummary(manifest) }
}

export async function listWorkbench(input: ListWorkbenchInput = {}): Promise<ListWorkbenchResult> {
  const file = await loadWorkspaceFile(input.workspace_id)
  const limit = normalizeLimit(input.limit)
  const offset = input.cursor ? Number(input.cursor) : 0
  const safeOffset = Number.isInteger(offset) && offset > 0 ? offset : 0
  const slice = file.cells.slice(safeOffset, safeOffset + limit)
  const cells = await Promise.all(slice.map((manifest) => toSummary(manifest)))
  const nextOffset = safeOffset + slice.length
  return {
    cells,
    next_cursor: nextOffset < file.cells.length ? String(nextOffset) : undefined
  }
}

export async function getWorkbenchCell(
  input: GetWorkbenchCellInput
): Promise<GetWorkbenchCellResult> {
  const file = await loadWorkspaceFile(input.workspace_id)
  const manifest = file.cells.find((cell) => cell.id === input.id)
  if (!manifest) throw new Error('Workbench cell not found.')
  return { cell: await manifestToCell(manifest) }
}

export async function deleteWorkbenchCell(
  input: DeleteWorkbenchCellInput
): Promise<DeleteWorkbenchCellResult> {
  const file = await loadWorkspaceFile(input.workspace_id)
  const manifest = file.cells.find((cell) => cell.id === input.id)
  if (!manifest) return { deleted: false }

  const cells = file.cells.filter((cell) => cell.id !== input.id)
  await saveWorkspaceFile({
    ...file,
    workspace: { ...file.workspace, updated_at: nowIso() },
    cells
  })

  if (
    manifest.cell.renderer === 'json-render' &&
    (manifest.cell.cell_ui_ref.storage === 'managed' ||
      manifest.cell.detailed_ui_ref?.storage === 'managed')
  ) {
    await removeManagedCellDir(file.workspace.id, manifest.id)
  }

  return { deleted: true }
}

export async function updateWorkbenchLayout(input: UpdateWorkbenchLayoutInput): Promise<void> {
  const file = await loadWorkspaceFile(input.workspace_id)
  const timestamp = nowIso()
  const layoutById = new Map(input.cells.map((cell) => [cell.id, validateLayout(cell.layout)]))
  const cells = file.cells.map((cell) => {
    const layout = layoutById.get(cell.id)
    return layout ? { ...cell, layout, layout_updated_at: timestamp } : cell
  })
  await saveWorkspaceFile({ ...file, cells })
}

export async function runWorkbenchCell(
  input: RunWorkbenchCellInput
): Promise<RunWorkbenchCellResult> {
  void input
  throw new Error('Workbench cell execution is unavailable.')
}
