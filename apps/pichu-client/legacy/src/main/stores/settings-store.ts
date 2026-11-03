import { join } from 'node:path'
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { app } from 'electron'
import {
  normalizeMessageKind,
  normalizeMessageVisibility,
  type PichuMessageKind,
  type PichuMessageVisibility
} from '../../shared/agent-message-visibility.js'
import {
  ARTIFACT_KINDS,
  type ArtifactPayload,
  type ArtifactRecord,
  type SaveArtifactRequest
} from '../../shared/artifacts.js'
import type { MessageAttachment } from '../../shared/attachments.js'
import { type AutoUpdateChannel, normalizeAutoUpdateChannel } from '../../shared/auto-update.js'
import { isDebugPackage } from '../../shared/build-mode.js'
import type { DevAppInstanceInfo } from '../../shared/dev-app-instance.js'
import { IMAGE_GENERATION_MODEL } from '../../shared/image-generation-config.js'
import {
  type MessagePart,
  normalizeMessageParts,
  parseMessagePartJson,
  stringifyMessagePart
} from '../../shared/message-parts.js'
import {
  configuredModelIdsFromStoredSettings,
  resolveConfiguredModelId
} from '../../shared/model-config.js'
import {
  DEFAULT_PICHU_THINKING_LEVEL,
  normalizePichuThinkingLevel,
  normalizeSessionModelUpdatedBy,
  type PichuThinkingLevel,
  type RunModelUsage,
  type SessionModelPreference,
  type SessionModelUpdatedBy
} from '../../shared/model-settings.js'
import { MODEL_TRAJECTORY_LOG_DIR_NAME } from '../../shared/model-trajectory.js'
import { type AgentTrustProfile, normalizeAgentTrustProfile } from '../../shared/tool-approval.js'
import { db, initDatabase, sqlite } from '../db/index.js'
import { agentRuns, artifacts, messageParts, messages, sessions, settings } from '../db/schema.js'
import { getDevAppInstanceInfo } from '../dev-app-instance.js'
import { pruneUnknownFeatureGateSettings } from '../feature-gates/local-feature-gate-service.js'
import {
  applyNewDataRoot,
  defaultWorkspaceRoot,
  ensureDataRootDir,
  getDataRoot,
  resolvePichuPath,
  writeBootstrapIfMissing
} from '../pichu-paths.js'
import { COMPUTER_USE_PLUGIN_NAME, isPluginHiddenFromUsers } from '../plugins/plugin-exposure.js'
import { isInstalledPluginEnabled } from '../plugins/plugin-registry.js'

const STALE_RUNNING_RUN_ERROR = 'Agent run was interrupted before completion.'
const UNREAD_SESSION_IDS_SETTING_KEY = 'unreadSessionIds'

export type LanguageSetting = 'auto' | 'zh-CN' | 'en'
export type FollowUpBehaviorSetting = 'queue' | 'steer'
export type CompletionNotificationsSetting = 'never' | 'unfocused' | 'always'
export type ThemeModeSetting = 'system' | 'light' | 'dark'

let settingsUpdatedCallback: (() => void) | null = null

function normalizeStoredPath(path: string): string {
  try {
    return resolvePichuPath(path)
  } catch {
    return path
  }
}

export function setSettingsUpdatedCallback(callback: (() => void) | null): void {
  settingsUpdatedCallback = callback
}

export type SessionIndexEntry = {
  sessionId: string
  agentId: string
  cwd: string
  title: string
  sessionKind?: 'main' | 'side'
  parentSessionId?: string | null
  createdAt: string
  updatedAt: string
  archivedAt?: string | null
  pinned?: boolean
  pinnedOrder?: number
  sessionModelId?: string | null
  sessionThinkingLevel?: PichuThinkingLevel | null
  sessionModelUpdatedAt?: string | null
  sessionModelUpdatedBy?: SessionModelUpdatedBy | null
}

export type SessionIndexSortKey = 'updated' | 'created'

type SessionKind = NonNullable<SessionIndexEntry['sessionKind']>

function normalizeSessionKind(value: string | null | undefined): SessionKind {
  return value === 'side' ? 'side' : 'main'
}

function rowToSessionIndexEntry(row: typeof sessions.$inferSelect): SessionIndexEntry {
  return {
    sessionId: row.sessionId,
    agentId: row.agentId,
    cwd: row.cwd,
    title: row.title,
    sessionKind: normalizeSessionKind(row.sessionKind),
    parentSessionId: row.parentSessionId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
    pinned: row.pinned === 1,
    pinnedOrder: row.pinnedOrder,
    sessionModelId: row.sessionModelId,
    sessionThinkingLevel: row.sessionThinkingLevel
      ? normalizeSessionThinkingLevel(row.sessionThinkingLevel)
      : null,
    sessionModelUpdatedAt: row.sessionModelUpdatedAt,
    sessionModelUpdatedBy: row.sessionModelUpdatedBy
      ? normalizeSessionModelUpdatedBy(row.sessionModelUpdatedBy)
      : null
  }
}

export type MessageRow = {
  id: string
  sessionId: string
  runId?: string | null
  role: 'user' | 'assistant' | 'system' | 'tool'
  kind?: PichuMessageKind | null
  content: string
  agentContent: string
  visibility: PichuMessageVisibility
  sortOrder: number
  createdAt: string
  toolCallId?: string | null
  toolName?: string | null
  toolCallResult?: string | null
  attachmentsJson?: string | null
  modelId?: string | null
  modelProvider?: string | null
  modelApi?: string | null
  modelUsageJson?: string | null
  runStatus?: AgentRunStatus | null
  runStartedAt?: string | null
  runCompletedAt?: string | null
  runDurationMs?: number | null
  runError?: string | null
  parts?: MessagePart[]
}

export type AgentRunStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export type AgentRunRow = {
  id: string
  sessionId: string
  status: AgentRunStatus
  startedAt: string
  completedAt?: string | null
  durationMs?: number | null
  error?: string | null
  requestedModelId?: string | null
  requestedThinkingLevel?: PichuThinkingLevel | null
  effectiveModelId?: string | null
  effectiveThinkingLevel?: PichuThinkingLevel | null
  effectiveReason?: RunModelUsage['effectiveReason'] | null
}

export type ImportedSession = SessionIndexEntry & {
  messages: MessageRow[]
}

type ToolCallContent = {
  name?: string
  arguments?: Record<string, unknown>
  assistantContent?: unknown[]
}

function normalizeSessionThinkingLevel(
  value: string | null | undefined,
  fallback: PichuThinkingLevel = DEFAULT_PICHU_THINKING_LEVEL
): PichuThinkingLevel {
  return normalizePichuThinkingLevel(value, fallback)
}

export type SessionSearchHighlight = {
  start: number
  end: number
}

export type SessionSearchResult = {
  sessionId: string
  title: string
  cwd: string
  sessionCreatedAt: string
  sessionUpdatedAt: string
  messageId: string | null
  role: 'user' | 'assistant' | 'system' | 'tool' | 'session'
  content: string
  snippet: string
  highlights: SessionSearchHighlight[]
  sortOrder: number | null
  messageCreatedAt: string | null
  toolName?: string | null
}

export type SessionSearchQuery = {
  text: string
  limit?: number
}

export function initSettingsStore(): void {
  ensureDataRootDir()
  writeBootstrapIfMissing()
  initDatabase()
  const configuredModelIds = getConfiguredModelIds()
  const selectedModelId = getStoredSetting('model')?.trim()
  if (selectedModelId && !configuredModelIds.includes(selectedModelId)) {
    deleteStoredSetting('model')
  }
  deleteStoredSetting('showModelSwitcher')
  failStaleRunningAgentRuns()
  pruneUnknownFeatureGateSettings()
}

export function getStoredSetting(key: string): string | undefined {
  const row = db().select().from(settings).where(eq(settings.key, key)).get()
  return row?.value
}

export function getModelTrajectoryLoggingEnabled(): boolean {
  const stored = getStoredSetting('modelTrajectoryLoggingEnabled')
  if (stored === 'true') return true
  if (stored === 'false') return false
  return isDebugPackage || app.getVersion().includes('-beta')
}

export function getAgentTrustProfile(): AgentTrustProfile {
  return normalizeAgentTrustProfile(getStoredSetting('agentTrustProfile'))
}

function getConfiguredModelIds(): string[] {
  const subscriptionModels = getStoredSetting('openAiOAuthCredential')
    ? getStoredSetting('openAiOAuthEnabledModels')
    : undefined
  return configuredModelIdsFromStoredSettings(getStoredSetting('userModels'), subscriptionModels, [
    IMAGE_GENERATION_MODEL
  ])
}

export function setStoredSetting(key: string, value: string): void {
  db()
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run()
}

export function deleteStoredSetting(key: string): void {
  db().delete(settings).where(eq(settings.key, key)).run()
}

function normalizeSessionIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean))
  ]
}

export function getUnreadSessionIds(): string[] {
  const stored = getStoredSetting(UNREAD_SESSION_IDS_SETTING_KEY)
  if (!stored) return []
  try {
    return normalizeSessionIdList(JSON.parse(stored))
  } catch {
    return []
  }
}

export function setUnreadSessionIds(sessionIds: unknown): string[] {
  const normalized = normalizeSessionIdList(sessionIds)
  setStoredSetting(UNREAD_SESSION_IDS_SETTING_KEY, JSON.stringify(normalized))
  return normalized
}

export function getSettingsForRenderer(): {
  model: string
  thinkingLevel: PichuThinkingLevel
  dataRoot: string
  workingDirectory: string
  enableAgentsSkills: boolean
  enableClaudeSkills: boolean
  computerUseEnabled: boolean
  debugMode: boolean
  language: LanguageSetting
  autoUpdateChannel: AutoUpdateChannel
  showInMenuBar: boolean
  showModelSwitcher: boolean
  followUpBehavior: FollowUpBehaviorSetting
  completionNotifications: CompletionNotificationsSetting
  approvalNotifications: boolean
  questionNotifications: boolean
  themeMode: ThemeModeSetting
  modelTrajectoryLoggingEnabled: boolean
  modelTrajectoryLogDirectory: string
  automationKeepAwake: boolean
  projectSortKey: 'updated' | 'created' | 'name'
  agentTrustProfile: AgentTrustProfile
  devInstance: DevAppInstanceInfo | null
  devInstanceBadgeVisible: boolean
} {
  const dataRoot = getDataRoot()
  const devInstance = getDevAppInstanceInfo()
  const language = getStoredSetting('language')
  const autoUpdateChannel = getStoredSetting('autoUpdateChannel')
  const followUpBehavior = getStoredSetting('followUpBehavior')
  const completionNotifications = getStoredSetting('completionNotifications')
  const themeMode = getStoredSetting('themeMode')
  const projectSortKey = getStoredSetting('projectSortKey')
  const configuredModelIds = getConfiguredModelIds()
  const storedModel = getStoredSetting('model')?.trim()
  const model = resolveConfiguredModelId(storedModel, configuredModelIds)
  const thinkingLevel = getStoredSetting('thinkingLevel')
  const storedWorkingDirectory = getStoredSetting('workingDirectory')?.trim()
  const resolvedWorkingDirectory = storedWorkingDirectory
    ? normalizeStoredPath(storedWorkingDirectory)
    : null
  return {
    model,
    thinkingLevel: normalizePichuThinkingLevel(thinkingLevel, DEFAULT_PICHU_THINKING_LEVEL),
    dataRoot,
    workingDirectory:
      resolvedWorkingDirectory && resolvedWorkingDirectory !== dataRoot
        ? resolvedWorkingDirectory
        : defaultWorkspaceRoot(),
    enableAgentsSkills: getStoredSetting('enableAgentsSkills') !== 'false',
    enableClaudeSkills: getStoredSetting('enableClaudeSkills') !== 'false',
    computerUseEnabled:
      !isPluginHiddenFromUsers({ name: COMPUTER_USE_PLUGIN_NAME }) &&
      isInstalledPluginEnabled(COMPUTER_USE_PLUGIN_NAME),
    debugMode: getStoredSetting('debugMode') === 'true',
    language: language === 'zh-CN' || language === 'en' ? language : 'auto',
    autoUpdateChannel: normalizeAutoUpdateChannel(
      autoUpdateChannel ?? (app.getVersion().includes('-beta') ? 'beta' : 'stable')
    ),
    showInMenuBar: getStoredSetting('showInMenuBar') !== 'false',
    showModelSwitcher: true,
    followUpBehavior: followUpBehavior === 'steer' ? 'steer' : 'queue',
    completionNotifications:
      completionNotifications === 'never' || completionNotifications === 'always'
        ? completionNotifications
        : 'unfocused',
    approvalNotifications: getStoredSetting('approvalNotifications') !== 'false',
    questionNotifications: getStoredSetting('questionNotifications') !== 'false',
    themeMode: themeMode === 'light' || themeMode === 'dark' ? themeMode : 'system',
    modelTrajectoryLoggingEnabled: getModelTrajectoryLoggingEnabled(),
    modelTrajectoryLogDirectory: join(dataRoot, MODEL_TRAJECTORY_LOG_DIR_NAME),
    automationKeepAwake: getStoredSetting('automationKeepAwake') === 'true',
    projectSortKey:
      projectSortKey === 'updated' || projectSortKey === 'created' ? projectSortKey : 'name',
    agentTrustProfile: getAgentTrustProfile(),
    devInstance,
    devInstanceBadgeVisible: devInstance
      ? getStoredSetting('devInstanceBadgeVisible') !== 'false'
      : false
  }
}

export type SettingsPatch = {
  model?: string
  thinkingLevel?: PichuThinkingLevel
  dataRoot?: string
  workingDirectory?: string
  enableAgentsSkills?: boolean
  enableClaudeSkills?: boolean
  debugMode?: boolean
  language?: LanguageSetting
  autoUpdateChannel?: AutoUpdateChannel
  showInMenuBar?: boolean
  showModelSwitcher?: boolean
  followUpBehavior?: FollowUpBehaviorSetting
  completionNotifications?: CompletionNotificationsSetting
  approvalNotifications?: boolean
  questionNotifications?: boolean
  themeMode?: ThemeModeSetting
  modelTrajectoryLoggingEnabled?: boolean
  automationKeepAwake?: boolean
  projectSortKey?: 'updated' | 'created' | 'name'
  agentTrustProfile?: AgentTrustProfile
  devInstanceBadgeVisible?: boolean
}

export function applySettingsPatch(
  patch: SettingsPatch
): ReturnType<typeof getSettingsForRenderer> | { restarting: true } {
  if (patch.dataRoot !== undefined) {
    if (applyNewDataRoot(patch.dataRoot) === 'restarting') {
      return { restarting: true }
    }
    return getSettingsForRenderer()
  }
  if (patch.model !== undefined) {
    const model = patch.model.trim()
    if (!getConfiguredModelIds().includes(model)) throw new Error('Select a configured model')
    setStoredSetting('model', model)
  }
  if (patch.thinkingLevel !== undefined) {
    setStoredSetting(
      'thinkingLevel',
      normalizePichuThinkingLevel(patch.thinkingLevel, DEFAULT_PICHU_THINKING_LEVEL)
    )
  }
  if (patch.workingDirectory !== undefined) {
    setStoredSetting('workingDirectory', patch.workingDirectory)
  }
  if (patch.enableAgentsSkills !== undefined) {
    setStoredSetting('enableAgentsSkills', String(patch.enableAgentsSkills))
  }
  if (patch.enableClaudeSkills !== undefined) {
    setStoredSetting('enableClaudeSkills', String(patch.enableClaudeSkills))
  }
  if (patch.debugMode !== undefined) {
    setStoredSetting('debugMode', String(patch.debugMode))
  }
  if (patch.language !== undefined) {
    setStoredSetting('language', patch.language)
  }
  if (patch.autoUpdateChannel !== undefined) {
    setStoredSetting('autoUpdateChannel', normalizeAutoUpdateChannel(patch.autoUpdateChannel))
  }
  if (patch.showInMenuBar !== undefined) {
    setStoredSetting('showInMenuBar', String(patch.showInMenuBar))
  }
  if (patch.showModelSwitcher !== undefined) {
    setStoredSetting('showModelSwitcher', String(patch.showModelSwitcher))
  }
  if (patch.followUpBehavior !== undefined) {
    setStoredSetting('followUpBehavior', patch.followUpBehavior)
  }
  if (patch.completionNotifications !== undefined) {
    setStoredSetting('completionNotifications', patch.completionNotifications)
  }
  if (patch.approvalNotifications !== undefined) {
    setStoredSetting('approvalNotifications', String(patch.approvalNotifications))
  }
  if (patch.questionNotifications !== undefined) {
    setStoredSetting('questionNotifications', String(patch.questionNotifications))
  }
  if (patch.themeMode !== undefined) {
    setStoredSetting('themeMode', patch.themeMode)
  }
  if (patch.modelTrajectoryLoggingEnabled !== undefined) {
    setStoredSetting(
      'modelTrajectoryLoggingEnabled',
      patch.modelTrajectoryLoggingEnabled ? 'true' : 'false'
    )
  }
  if (patch.automationKeepAwake !== undefined) {
    setStoredSetting('automationKeepAwake', String(patch.automationKeepAwake))
  }
  if (patch.projectSortKey !== undefined) {
    setStoredSetting('projectSortKey', patch.projectSortKey)
  }
  if (patch.agentTrustProfile !== undefined) {
    setStoredSetting('agentTrustProfile', normalizeAgentTrustProfile(patch.agentTrustProfile))
  }
  if (patch.devInstanceBadgeVisible !== undefined && getDevAppInstanceInfo()) {
    setStoredSetting('devInstanceBadgeVisible', String(patch.devInstanceBadgeVisible))
  }
  settingsUpdatedCallback?.()
  return getSettingsForRenderer()
}

const MAX_SESSION_INDEX = 100

export function setSessionPinned(sessionId: string, pinned: boolean): void {
  const entry = getSessionById(sessionId)
  if (!entry) {
    throw new Error(`Unknown session: ${sessionId}`)
  }
  if (entry.sessionKind === 'side') {
    throw new Error('Side chat sessions cannot be pinned')
  }

  const nextPinnedOrder = pinned
    ? (db()
        .select({ pinnedOrder: sessions.pinnedOrder })
        .from(sessions)
        .orderBy(desc(sessions.pinnedOrder))
        .limit(1)
        .get()?.pinnedOrder ?? 0) + 1
    : 0
  db()
    .update(sessions)
    .set({ pinned: pinned ? 1 : 0, pinnedOrder: nextPinnedOrder })
    .where(eq(sessions.sessionId, sessionId))
    .run()
}

export function reorderPinnedSessions(sessionIds: string[]): void {
  const orderedSessionIds = [...new Set(sessionIds)]
  for (const sessionId of orderedSessionIds) {
    const entry = getSessionById(sessionId)
    if (!entry) {
      throw new Error(`Unknown session: ${sessionId}`)
    }
    if (entry.sessionKind === 'side') {
      throw new Error('Side chat sessions cannot be pinned')
    }
  }

  db().transaction((tx) => {
    orderedSessionIds.forEach((sessionId, index) => {
      tx.update(sessions)
        .set({
          pinned: 1,
          pinnedOrder: orderedSessionIds.length - index
        })
        .where(eq(sessions.sessionId, sessionId))
        .run()
    })
  })
}

export function getCachedSharedSessionUrl(
  sessionId: string,
  sourceUpdatedAt: string
): string | undefined {
  const row = db()
    .select({
      sharedSessionUrl: sessions.sharedSessionUrl,
      sharedSessionSourceUpdatedAt: sessions.sharedSessionSourceUpdatedAt
    })
    .from(sessions)
    .where(eq(sessions.sessionId, sessionId))
    .get()

  if (
    row?.sharedSessionUrl &&
    row.sharedSessionSourceUpdatedAt &&
    row.sharedSessionSourceUpdatedAt === sourceUpdatedAt
  ) {
    return row.sharedSessionUrl
  }
  return undefined
}

export function saveSharedSessionUrl(params: {
  sessionId: string
  url: string
  sourceUpdatedAt: string
}): void {
  db()
    .update(sessions)
    .set({
      sharedSessionUrl: params.url,
      sharedSessionSourceUpdatedAt: params.sourceUpdatedAt
    })
    .where(eq(sessions.sessionId, params.sessionId))
    .run()
}

export function getSessionIndex(sortKey: SessionIndexSortKey = 'updated'): SessionIndexEntry[] {
  const sortColumn = sortKey === 'created' ? sessions.createdAt : sessions.updatedAt
  const rows = db()
    .select()
    .from(sessions)
    .where(and(isNull(sessions.archivedAt), eq(sessions.sessionKind, 'main')))
    .orderBy(desc(sessions.pinned), desc(sessions.pinnedOrder), desc(sortColumn))
    .limit(MAX_SESSION_INDEX)
    .all()

  return rows.map(rowToSessionIndexEntry)
}

export function getArchivedSessionIndex(): SessionIndexEntry[] {
  return db()
    .select()
    .from(sessions)
    .where(and(isNotNull(sessions.archivedAt), eq(sessions.sessionKind, 'main')))
    .orderBy(desc(sessions.archivedAt), desc(sessions.updatedAt))
    .all()
    .map(rowToSessionIndexEntry)
}

export function getSessionById(sessionId: string): SessionIndexEntry | undefined {
  const row = db().select().from(sessions).where(eq(sessions.sessionId, sessionId)).get()
  if (!row) return undefined
  return rowToSessionIndexEntry(row)
}

export function updateSessionCwd(sessionId: string, cwd: string): void {
  db().update(sessions).set({ cwd }).where(eq(sessions.sessionId, sessionId)).run()
}

export function expireSideSessionsFromIndex(): number {
  const result = db().delete(sessions).where(eq(sessions.sessionKind, 'side')).run()
  return result.changes
}

export function getSideSessionsForParent(parentSessionId: string): SessionIndexEntry[] {
  return db()
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.parentSessionId, parentSessionId),
        eq(sessions.sessionKind, 'side'),
        isNull(sessions.archivedAt)
      )
    )
    .orderBy(desc(sessions.updatedAt), desc(sessions.createdAt))
    .all()
    .map(rowToSessionIndexEntry)
}

export function deleteSideSessionFromIndex(sessionId: string): void {
  db()
    .delete(sessions)
    .where(and(eq(sessions.sessionId, sessionId), eq(sessions.sessionKind, 'side')))
    .run()
}

export function deleteSideSessionsForParent(parentSessionId: string): number {
  const result = db()
    .delete(sessions)
    .where(and(eq(sessions.parentSessionId, parentSessionId), eq(sessions.sessionKind, 'side')))
    .run()
  return result.changes
}

export function getSessionBySharedSessionUrl(url: string): SessionIndexEntry | undefined {
  const row = db()
    .select({ sessionId: sessions.sessionId })
    .from(sessions)
    .where(eq(sessions.sharedSessionUrl, url))
    .get()
  return row?.sessionId ? getSessionById(row.sessionId) : undefined
}

function preferenceFromSessionRow(
  row: typeof sessions.$inferSelect
): SessionModelPreference | null {
  const modelId = row.sessionModelId?.trim()
  if (!modelId) return null
  return {
    sessionId: row.sessionId,
    modelId,
    thinkingLevel: normalizeSessionThinkingLevel(row.sessionThinkingLevel),
    updatedAt: row.sessionModelUpdatedAt ?? row.updatedAt,
    updatedBy: normalizeSessionModelUpdatedBy(row.sessionModelUpdatedBy)
  }
}

export function getSessionModelPreference(sessionId: string): SessionModelPreference {
  const row = db().select().from(sessions).where(eq(sessions.sessionId, sessionId)).get()
  if (!row) {
    throw new Error(`Unknown session: ${sessionId}`)
  }

  const existing = preferenceFromSessionRow(row)
  if (existing) return existing

  const settings = getSettingsForRenderer()
  const modelId = settings.model.trim()
  if (!modelId) {
    throw new Error('No LLM model is configured. Add one in Settings > Models.')
  }
  return setSessionModelPreference({
    sessionId,
    modelId,
    thinkingLevel: normalizeSessionThinkingLevel(settings.thinkingLevel),
    updatedBy: 'migration'
  })
}

export function setSessionModelPreference(params: {
  sessionId: string
  modelId: string
  thinkingLevel: PichuThinkingLevel
  updatedAt?: string
  updatedBy: SessionModelUpdatedBy
}): SessionModelPreference {
  const modelId = params.modelId.trim()
  if (!modelId) {
    throw new Error('Session model id is required')
  }

  const updatedAt = params.updatedAt ?? new Date().toISOString()
  const thinkingLevel = normalizeSessionThinkingLevel(params.thinkingLevel)
  const result = db()
    .update(sessions)
    .set({
      sessionModelId: modelId,
      sessionThinkingLevel: thinkingLevel,
      sessionModelUpdatedAt: updatedAt,
      sessionModelUpdatedBy: params.updatedBy
    })
    .where(eq(sessions.sessionId, params.sessionId))
    .run()
  if (result.changes === 0) {
    throw new Error(`Unknown session: ${params.sessionId}`)
  }

  return {
    sessionId: params.sessionId,
    modelId,
    thinkingLevel,
    updatedAt,
    updatedBy: params.updatedBy
  }
}

export function getSessionsByAgentId(agentId: string): SessionIndexEntry[] {
  return db()
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.agentId, agentId),
        isNull(sessions.archivedAt),
        eq(sessions.sessionKind, 'main')
      )
    )
    .orderBy(desc(sessions.createdAt))
    .all()
    .map(rowToSessionIndexEntry)
}

export function addSessionToIndex(entry: SessionIndexEntry): void {
  const sessionModelValues = entry.sessionModelId
    ? {
        sessionModelId: entry.sessionModelId,
        sessionThinkingLevel: entry.sessionThinkingLevel
          ? normalizeSessionThinkingLevel(entry.sessionThinkingLevel)
          : DEFAULT_PICHU_THINKING_LEVEL,
        sessionModelUpdatedAt: entry.sessionModelUpdatedAt ?? entry.updatedAt,
        sessionModelUpdatedBy: entry.sessionModelUpdatedBy ?? 'default'
      }
    : {
        sessionModelId: null,
        sessionThinkingLevel: null,
        sessionModelUpdatedAt: null,
        sessionModelUpdatedBy: null
      }
  const updateModelValues = entry.sessionModelId ? sessionModelValues : {}

  db()
    .insert(sessions)
    .values({
      sessionId: entry.sessionId,
      agentId: entry.agentId,
      cwd: entry.cwd,
      title: entry.title,
      sessionKind: entry.sessionKind ?? 'main',
      parentSessionId: entry.parentSessionId ?? null,
      pinned: entry.sessionKind === 'side' ? 0 : entry.pinned === true ? 1 : 0,
      pinnedOrder: entry.sessionKind === 'side' ? 0 : (entry.pinnedOrder ?? 0),
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      ...sessionModelValues
    })
    .onConflictDoUpdate({
      target: sessions.sessionId,
      set: {
        agentId: entry.agentId,
        cwd: entry.cwd,
        title: entry.title,
        sessionKind: entry.sessionKind ?? 'main',
        parentSessionId: entry.parentSessionId ?? null,
        updatedAt: entry.updatedAt,
        ...updateModelValues
      }
    })
    .run()
}

export function addImportedSession(entry: ImportedSession): void {
  const database = db()
  database.transaction((tx) => {
    tx.insert(sessions)
      .values({
        sessionId: entry.sessionId,
        agentId: entry.agentId,
        cwd: entry.cwd,
        title: entry.title,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        sessionModelId: entry.sessionModelId ?? null,
        sessionThinkingLevel: entry.sessionThinkingLevel
          ? normalizeSessionThinkingLevel(entry.sessionThinkingLevel)
          : null,
        sessionModelUpdatedAt: entry.sessionModelUpdatedAt ?? null,
        sessionModelUpdatedBy: entry.sessionModelUpdatedBy ?? null
      })
      .run()

    const orderedMessages = [...entry.messages].sort((a, b) => a.sortOrder - b.sortOrder)
    for (const message of orderedMessages) {
      tx.insert(messages)
        .values({
          id: message.id,
          sessionId: entry.sessionId,
          role: message.role,
          content: message.content,
          agentContent: message.agentContent,
          visibility: message.visibility,
          sortOrder: message.sortOrder,
          createdAt: message.createdAt,
          toolCallId: message.toolCallId ?? null,
          toolName: message.toolName ?? null,
          toolCallResult: message.toolCallResult ?? null,
          attachmentsJson: message.attachmentsJson ?? null,
          modelId: message.modelId ?? null,
          modelProvider: message.modelProvider ?? null,
          modelApi: message.modelApi ?? null,
          modelUsageJson: message.modelUsageJson ?? null
        })
        .run()
      insertMessageParts(tx, message)
    }
  })
}

export function updateSessionTitle(sessionId: string, title: string): void {
  db()
    .update(sessions)
    .set({ title, updatedAt: new Date().toISOString() })
    .where(eq(sessions.sessionId, sessionId))
    .run()
}

export function archiveSessionInIndex(sessionId: string): void {
  const now = new Date().toISOString()
  db()
    .update(sessions)
    .set({
      archivedAt: now,
      pinned: 0,
      pinnedOrder: 0
    })
    .where(eq(sessions.sessionId, sessionId))
    .run()
}

export function unarchiveSessionInIndex(sessionId: string): void {
  const database = db()
  const row = database
    .select({
      archivedAt: sessions.archivedAt,
      createdAt: sessions.createdAt,
      updatedAt: sessions.updatedAt
    })
    .from(sessions)
    .where(eq(sessions.sessionId, sessionId))
    .get()
  if (!row) return

  const latestMessage = database
    .select({ createdAt: messages.createdAt })
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(desc(messages.createdAt))
    .limit(1)
    .get()
  const restoredUpdatedAt =
    row.archivedAt && row.updatedAt === row.archivedAt
      ? (latestMessage?.createdAt ?? row.createdAt)
      : undefined

  database
    .update(sessions)
    .set(
      restoredUpdatedAt ? { archivedAt: null, updatedAt: restoredUpdatedAt } : { archivedAt: null }
    )
    .where(eq(sessions.sessionId, sessionId))
    .run()
}

export function deleteArchivedSessionFromIndex(sessionId: string): void {
  db()
    .delete(sessions)
    .where(and(eq(sessions.sessionId, sessionId), isNotNull(sessions.archivedAt)))
    .run()
}

export function deleteAllArchivedSessionsFromIndex(): number {
  const result = db().delete(sessions).where(isNotNull(sessions.archivedAt)).run()
  return result.changes
}

export function createAgentRun(params: {
  sessionId: string
  runId?: string
  startedAt?: string
}): AgentRunRow {
  const row: AgentRunRow = {
    id: params.runId ?? crypto.randomUUID(),
    sessionId: params.sessionId,
    status: 'running',
    startedAt: params.startedAt ?? new Date().toISOString(),
    completedAt: null,
    durationMs: null,
    error: null
  }

  db().insert(agentRuns).values(row).run()
  return row
}

export function finishAgentRun(params: {
  runId: string
  status: Exclude<AgentRunStatus, 'running'>
  error?: string | null
  completedAt?: string
}): AgentRunRow | null {
  const existing = db().select().from(agentRuns).where(eq(agentRuns.id, params.runId)).get()
  if (!existing) return null

  const completedAt = params.completedAt ?? new Date().toISOString()
  const durationMs = Math.max(
    0,
    new Date(completedAt).getTime() - new Date(existing.startedAt).getTime()
  )
  const row: AgentRunRow = {
    ...existing,
    status: params.status,
    completedAt,
    durationMs,
    error: params.error ?? null
  }

  db()
    .update(agentRuns)
    .set({
      status: row.status,
      completedAt: row.completedAt,
      durationMs: row.durationMs,
      error: row.error
    })
    .where(eq(agentRuns.id, params.runId))
    .run()
  return row
}

export function getAgentRunStatus(runId: string): AgentRunStatus | null {
  return (
    db().select({ status: agentRuns.status }).from(agentRuns).where(eq(agentRuns.id, runId)).get()
      ?.status ?? null
  )
}

function failStaleRunningAgentRuns(): void {
  const runningRuns = db()
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(eq(agentRuns.status, 'running'))
    .all()

  for (const run of runningRuns) {
    finishAgentRun({
      runId: run.id,
      status: 'failed',
      error: STALE_RUNNING_RUN_ERROR
    })
  }
}

export function updateAgentRunModelUsage(params: {
  runId: string
  usage: RunModelUsage
}): AgentRunRow | null {
  const existing = db().select().from(agentRuns).where(eq(agentRuns.id, params.runId)).get()
  if (!existing) return null

  const row: AgentRunRow = {
    ...existing,
    requestedModelId: params.usage.requestedModelId,
    requestedThinkingLevel: params.usage.requestedThinkingLevel,
    effectiveModelId: params.usage.effectiveModelId,
    effectiveThinkingLevel: params.usage.effectiveThinkingLevel,
    effectiveReason: params.usage.effectiveReason ?? 'normal'
  }

  db()
    .update(agentRuns)
    .set({
      requestedModelId: row.requestedModelId,
      requestedThinkingLevel: row.requestedThinkingLevel,
      effectiveModelId: row.effectiveModelId,
      effectiveThinkingLevel: row.effectiveThinkingLevel,
      effectiveReason: row.effectiveReason
    })
    .where(eq(agentRuns.id, params.runId))
    .run()
  return row
}

export function addMessages(rows: MessageRow[]): void {
  if (rows.length === 0) return

  const database = db()
  database.transaction((tx) => {
    for (const msg of rows) {
      tx.insert(messages)
        .values({
          id: msg.id,
          sessionId: msg.sessionId,
          runId: msg.runId ?? null,
          role: msg.role,
          kind: normalizeMessageKind(msg.kind),
          content: msg.content,
          agentContent: msg.agentContent,
          visibility: msg.visibility,
          sortOrder: msg.sortOrder,
          createdAt: msg.createdAt,
          toolCallId: msg.toolCallId ?? null,
          toolName: msg.toolName ?? null,
          toolCallResult: msg.toolCallResult ?? null,
          attachmentsJson: msg.attachmentsJson ?? null,
          modelId: msg.modelId ?? null,
          modelProvider: msg.modelProvider ?? null,
          modelApi: msg.modelApi ?? null,
          modelUsageJson: msg.modelUsageJson ?? null
        })
        .run()
      insertMessageParts(tx, msg)
    }

    const msg = rows[rows.length - 1]
    tx.update(sessions)
      .set({ updatedAt: msg.createdAt })
      .where(eq(sessions.sessionId, msg.sessionId))
      .run()
  })
}

export function addMessage(msg: MessageRow): void {
  addMessages([msg])
}

export function updateMessageParts(params: {
  sessionId: string
  messageId: string
  parts: readonly MessagePart[]
}): MessageRow | null {
  const existing = db()
    .select()
    .from(messages)
    .where(and(eq(messages.sessionId, params.sessionId), eq(messages.id, params.messageId)))
    .get()
  if (!existing) return null

  const normalizedParts = normalizeMessageParts(params.parts)
  const now = new Date().toISOString()
  const database = db()
  database.transaction((tx) => {
    tx.delete(messageParts)
      .where(
        and(
          eq(messageParts.sessionId, params.sessionId),
          eq(messageParts.messageId, params.messageId)
        )
      )
      .run()

    if (normalizedParts.length === 0) return

    tx.insert(messageParts)
      .values(
        normalizedParts.map((part, index) => ({
          id: part.id,
          messageId: params.messageId,
          sessionId: params.sessionId,
          position: index,
          type: part.type,
          dataJson: stringifyMessagePart(part),
          createdAt: existing.createdAt,
          updatedAt: now
        }))
      )
      .run()
  })

  return {
    ...existing,
    visibility: normalizeMessageVisibility(existing.visibility, existing.role),
    parts: normalizedParts
  }
}

export function updateMessageToolCallResult(
  sessionId: string,
  toolCallId: string,
  toolCallResult: string
): void {
  const now = new Date().toISOString()
  const database = db()
  database.transaction((tx) => {
    tx.update(messages)
      .set({ toolCallResult })
      .where(and(eq(messages.sessionId, sessionId), eq(messages.toolCallId, toolCallId)))
      .run()

    tx.update(sessions).set({ updatedAt: now }).where(eq(sessions.sessionId, sessionId)).run()
  })
}

function parseToolCallContent(content: string): ToolCallContent {
  try {
    const parsed = JSON.parse(content) as unknown
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as ToolCallContent
    }
  } catch {
    // Existing malformed tool rows are ignored and overwritten by the next valid update.
  }
  return {}
}

export function upsertToolCallMessage(params: {
  sessionId: string
  toolCallId: string
  runId?: string | null
  toolName?: string | null
  args?: Record<string, unknown>
  assistantContent?: unknown[]
  modelId?: string | null
  modelProvider?: string | null
  modelApi?: string | null
  modelUsageJson?: string | null
}): void {
  const existing = db()
    .select()
    .from(messages)
    .where(
      and(eq(messages.sessionId, params.sessionId), eq(messages.toolCallId, params.toolCallId))
    )
    .get()

  const existingContent = existing ? parseToolCallContent(existing.content) : {}
  const existingArgs =
    typeof existingContent.arguments === 'object' &&
    existingContent.arguments !== null &&
    !Array.isArray(existingContent.arguments)
      ? existingContent.arguments
      : {}
  const nextName = params.toolName ?? existing?.toolName ?? existingContent.name ?? 'tool'
  const nextArgs = params.args ? { ...existingArgs, ...params.args } : existingArgs
  const nextAssistantContent = params.assistantContent ?? existingContent.assistantContent
  const content = JSON.stringify({
    name: nextName,
    arguments: nextArgs,
    ...(nextAssistantContent && nextAssistantContent.length > 0
      ? { assistantContent: nextAssistantContent }
      : {})
  })

  if (existing) {
    const now = new Date().toISOString()
    const database = db()
    database.transaction((tx) => {
      tx.update(messages)
        .set({
          content,
          runId: params.runId ?? existing.runId,
          toolName: nextName,
          modelId: params.modelId ?? existing.modelId,
          modelProvider: params.modelProvider ?? existing.modelProvider,
          modelApi: params.modelApi ?? existing.modelApi,
          modelUsageJson: params.modelUsageJson ?? existing.modelUsageJson
        })
        .where(
          and(eq(messages.sessionId, params.sessionId), eq(messages.toolCallId, params.toolCallId))
        )
        .run()

      tx.update(sessions)
        .set({ updatedAt: now })
        .where(eq(sessions.sessionId, params.sessionId))
        .run()
    })
    return
  }

  addMessage({
    id: crypto.randomUUID(),
    sessionId: params.sessionId,
    runId: params.runId ?? null,
    role: 'tool',
    content,
    agentContent: '',
    visibility: 'shared',
    sortOrder: getNextSortOrder(params.sessionId),
    createdAt: new Date().toISOString(),
    toolCallId: params.toolCallId,
    toolName: nextName,
    toolCallResult: null,
    attachmentsJson: null,
    modelId: params.modelId ?? null,
    modelProvider: params.modelProvider ?? null,
    modelApi: params.modelApi ?? null,
    modelUsageJson: params.modelUsageJson ?? null,
    parts: []
  })
}

export function stringifyMessageAttachments(
  attachments: MessageAttachment[] | undefined
): string | null {
  if (!attachments || attachments.length === 0) return null
  return JSON.stringify(attachments)
}

type MessagePartInsertTx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0]

function insertMessageParts(tx: MessagePartInsertTx, msg: MessageRow): void {
  const parts = normalizeMessageParts(msg.parts)
  if (parts.length === 0) return

  const now = new Date().toISOString()
  tx.insert(messageParts)
    .values(
      parts.map((part, index) => ({
        id: part.id,
        messageId: msg.id,
        sessionId: msg.sessionId,
        position: index,
        type: part.type,
        dataJson: stringifyMessagePart(part),
        createdAt: msg.createdAt || now,
        updatedAt: msg.createdAt || now
      }))
    )
    .run()
}

export function getSessionMessages(sessionId: string): MessageRow[] {
  const rows = db()
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(messages.sortOrder)
    .all()
  if (rows.length === 0) return []

  const runRows = db().select().from(agentRuns).where(eq(agentRuns.sessionId, sessionId)).all()
  const runsById = new Map(runRows.map((run) => [run.id, run]))

  const partRows = db()
    .select()
    .from(messageParts)
    .where(eq(messageParts.sessionId, sessionId))
    .orderBy(messageParts.messageId, messageParts.position)
    .all()

  const partsByMessageId = new Map<string, MessagePart[]>()
  for (const row of partRows) {
    const part = parseMessagePartJson(row.dataJson)
    if (!part) continue
    const list = partsByMessageId.get(row.messageId)
    if (list) list.push(part)
    else partsByMessageId.set(row.messageId, [part])
  }

  return rows.map((row) => ({
    ...row,
    kind: normalizeMessageKind(row.kind),
    visibility: normalizeMessageVisibility(row.visibility, row.role),
    runStatus: row.runId ? (runsById.get(row.runId)?.status ?? null) : null,
    runStartedAt: row.runId ? (runsById.get(row.runId)?.startedAt ?? null) : null,
    runCompletedAt: row.runId ? (runsById.get(row.runId)?.completedAt ?? null) : null,
    runDurationMs: row.runId ? (runsById.get(row.runId)?.durationMs ?? null) : null,
    runError: row.runId ? (runsById.get(row.runId)?.error ?? null) : null,
    parts: partsByMessageId.get(row.id) ?? []
  }))
}

export function listArtifacts(): ArtifactRecord[] {
  return db()
    .select({
      id: artifacts.id,
      kind: artifacts.kind,
      title: artifacts.title,
      payloadJson: artifacts.payloadJson,
      sourceSessionId: artifacts.sourceSessionId,
      sourceMessageId: artifacts.sourceMessageId,
      sourceToolCallId: artifacts.sourceToolCallId,
      sourceSessionTitle: sessions.title,
      createdAt: artifacts.createdAt,
      updatedAt: artifacts.updatedAt
    })
    .from(artifacts)
    .leftJoin(sessions, eq(artifacts.sourceSessionId, sessions.sessionId))
    .orderBy(desc(artifacts.updatedAt))
    .all()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  return typeof value === 'string' ? value : undefined
}

function optionalNumber(value: unknown): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeArtifactPayload(
  kind: SaveArtifactRequest['kind'],
  payload: unknown
): ArtifactPayload {
  if (!isRecord(payload)) {
    throw new Error('Artifact payload must be an object.')
  }

  if (kind === 'streaming-ui') {
    if (
      payload.toolName !== 'streamingUITool' ||
      typeof payload.title !== 'string' ||
      typeof payload.html !== 'string'
    ) {
      throw new Error('Invalid streaming UI artifact payload.')
    }
    return {
      toolName: 'streamingUITool',
      title: payload.title,
      html: payload.html
    }
  }

  if (kind === 'text') {
    if (typeof payload.text !== 'string' || payload.text.trim().length === 0) {
      throw new Error('Text artifact payload requires text.')
    }
    const sourceLabel = optionalString(payload.sourceLabel)
    return {
      text: payload.text,
      ...(sourceLabel !== undefined ? { sourceLabel } : {})
    }
  }

  if (kind === 'file') {
    if (typeof payload.name !== 'string' || typeof payload.path !== 'string') {
      throw new Error('File artifact payload requires a file name and path.')
    }
    const mimeType = optionalString(payload.mimeType)
    const size = optionalNumber(payload.size)
    return {
      name: payload.name,
      path: payload.path,
      ...(mimeType !== undefined ? { mimeType } : {}),
      ...(size !== undefined ? { size } : {})
    }
  }

  if (payload.source === 'file') {
    if (typeof payload.name !== 'string' || typeof payload.path !== 'string') {
      throw new Error('Image file artifact payload requires a file name and path.')
    }
    const mimeType = optionalString(payload.mimeType)
    const size = optionalNumber(payload.size)
    const previewDataUrl = optionalString(payload.previewDataUrl)
    return {
      source: 'file',
      name: payload.name,
      path: payload.path,
      ...(mimeType !== undefined ? { mimeType } : {}),
      ...(size !== undefined ? { size } : {}),
      ...(previewDataUrl !== undefined ? { previewDataUrl } : {})
    }
  }

  if (payload.source === 'url') {
    if (typeof payload.title !== 'string' || typeof payload.url !== 'string') {
      throw new Error('Image URL artifact payload requires a title and URL.')
    }
    const alt = optionalString(payload.alt)
    return {
      source: 'url',
      title: payload.title,
      url: payload.url,
      ...(alt !== undefined ? { alt } : {})
    }
  }

  throw new Error('Invalid image artifact payload.')
}

function normalizeSaveArtifactRequest(request: SaveArtifactRequest): SaveArtifactRequest {
  const raw = request as unknown
  if (!isRecord(raw)) {
    throw new Error('Artifact request must be an object.')
  }

  if (!ARTIFACT_KINDS.includes(raw.kind as SaveArtifactRequest['kind'])) {
    throw new Error('Unsupported artifact kind.')
  }

  if (typeof raw.title !== 'string' || raw.title.trim().length === 0) {
    throw new Error('Artifact title is required.')
  }

  const kind = raw.kind as SaveArtifactRequest['kind']
  const sourceSessionId = optionalString(raw.sourceSessionId)
  const sourceMessageId = optionalString(raw.sourceMessageId)
  const sourceToolCallId = optionalString(raw.sourceToolCallId)
  return {
    kind,
    title: raw.title.trim(),
    payload: normalizeArtifactPayload(kind, raw.payload),
    ...(sourceSessionId !== undefined ? { sourceSessionId } : {}),
    ...(sourceMessageId !== undefined ? { sourceMessageId } : {}),
    ...(sourceToolCallId !== undefined ? { sourceToolCallId } : {})
  }
}

function findExistingSessionId(sessionId: string | null): string | null {
  if (!sessionId) return null
  const row = db()
    .select({ sessionId: sessions.sessionId })
    .from(sessions)
    .where(eq(sessions.sessionId, sessionId))
    .get()
  return row?.sessionId ?? null
}

function parseStoredAttachments(attachmentsJson: string | null | undefined): MessageAttachment[] {
  if (!attachmentsJson) return []
  try {
    const parsed = JSON.parse(attachmentsJson)
    return Array.isArray(parsed) ? (parsed as MessageAttachment[]) : []
  } catch {
    return []
  }
}

function findAttachmentSourceMessageId(
  sessionId: string,
  sourceToolCallId: string | null
): string | null {
  const attachmentPrefix = 'attachment:'
  if (!sourceToolCallId?.startsWith(attachmentPrefix)) return null

  const attachmentId = sourceToolCallId.slice(attachmentPrefix.length)
  if (!attachmentId) return null

  const rows = db()
    .select({
      id: messages.id,
      attachmentsJson: messages.attachmentsJson
    })
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .all()

  for (const row of rows) {
    const attachments = parseStoredAttachments(row.attachmentsJson)
    if (attachments.some((attachment) => attachment.id === attachmentId)) {
      return row.id
    }
  }

  return null
}

function normalizeSearchText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function findSelectionSourceMessageId(sessionId: string, payload: ArtifactPayload): string | null {
  if (!('text' in payload) || typeof payload.text !== 'string') return null

  const exactSelection = payload.text.trim()
  const normalizedSelection = normalizeSearchText(payload.text)
  if (!exactSelection && !normalizedSelection) return null

  const rows = db()
    .select({
      id: messages.id,
      content: messages.content
    })
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(desc(messages.sortOrder))
    .all()

  const exactMatch = rows.find((row) => row.content.includes(exactSelection))
  if (exactMatch) return exactMatch.id

  const normalizedMatch = rows.find((row) =>
    normalizeSearchText(row.content).includes(normalizedSelection)
  )
  return normalizedMatch?.id ?? null
}

function findToolCallSourceMessageId(
  sessionId: string,
  sourceToolCallId: string | null
): string | null {
  if (!sourceToolCallId) return null

  const row = db()
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.sessionId, sessionId), eq(messages.toolCallId, sourceToolCallId)))
    .get()
  return row?.id ?? null
}

function findExistingMessageId(
  sourceSessionId: string | null,
  sourceMessageId: string | null,
  sourceToolCallId: string | null,
  payload: ArtifactPayload
): string | null {
  if (!sourceSessionId) return null

  if (sourceMessageId) {
    const row = db()
      .select({
        id: messages.id,
        sessionId: messages.sessionId
      })
      .from(messages)
      .where(eq(messages.id, sourceMessageId))
      .get()
    if (row?.sessionId === sourceSessionId) {
      return row.id
    }
  }

  return (
    findAttachmentSourceMessageId(sourceSessionId, sourceToolCallId) ??
    findToolCallSourceMessageId(sourceSessionId, sourceToolCallId) ??
    findSelectionSourceMessageId(sourceSessionId, payload)
  )
}

export function saveArtifact(request: SaveArtifactRequest): ArtifactRecord {
  const normalized = normalizeSaveArtifactRequest(request)
  const now = new Date().toISOString()
  const requestedSourceSessionId = normalized.sourceSessionId?.trim() || null
  const sourceSessionId = findExistingSessionId(requestedSourceSessionId)
  const sourceToolCallId = normalized.sourceToolCallId?.trim() || null
  const sourceMessageId = findExistingMessageId(
    sourceSessionId,
    normalized.sourceMessageId?.trim() || null,
    sourceToolCallId,
    normalized.payload
  )
  const payloadJson = JSON.stringify(normalized.payload)

  const existing =
    sourceSessionId && sourceToolCallId
      ? db()
          .select()
          .from(artifacts)
          .where(
            and(
              eq(artifacts.sourceSessionId, sourceSessionId),
              eq(artifacts.sourceToolCallId, sourceToolCallId)
            )
          )
          .get()
      : undefined

  if (existing) {
    db()
      .update(artifacts)
      .set({
        kind: normalized.kind,
        title: normalized.title,
        payloadJson,
        sourceMessageId,
        updatedAt: now
      })
      .where(eq(artifacts.id, existing.id))
      .run()

    return {
      ...existing,
      kind: normalized.kind,
      title: normalized.title,
      payloadJson,
      sourceMessageId,
      updatedAt: now
    }
  }

  const row: ArtifactRecord = {
    id: crypto.randomUUID(),
    kind: normalized.kind,
    title: normalized.title,
    payloadJson,
    sourceSessionId,
    sourceMessageId,
    sourceToolCallId,
    createdAt: now,
    updatedAt: now
  }

  db().insert(artifacts).values(row).run()
  return row
}

export function deleteArtifact(id: string): { deleted: boolean } {
  const result = db().delete(artifacts).where(eq(artifacts.id, id)).run()
  return { deleted: result.changes > 0 }
}

const MIN_SEARCH_QUERY_LENGTH = 2
const DEFAULT_SEARCH_LIMIT = 50
const MAX_SEARCH_LIMIT = 100
const SNIPPET_MARK_START = '<<<pichu-match>>>'
const SNIPPET_MARK_END = '<<<pichu-end>>>'

type RawSearchRow = {
  sessionId: string
  title: string
  cwd: string
  sessionCreatedAt: string
  sessionUpdatedAt: string
  messageId: string | null
  role: 'user' | 'assistant' | 'system' | 'tool' | 'session'
  content: string | null
  snippet?: string | null
  sortOrder: number | null
  messageCreatedAt: string | null
  toolName?: string | null
  toolCallResult?: string | null
}

function clampSearchLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return DEFAULT_SEARCH_LIMIT
  return Math.max(1, Math.min(MAX_SEARCH_LIMIT, Math.floor(limit ?? DEFAULT_SEARCH_LIMIT)))
}

function getSearchTerms(text: string): string[] {
  const terms = text.match(/[\p{L}\p{N}_]+/gu) ?? []
  return [...new Set(terms.map((term) => term.toLocaleLowerCase()).filter(Boolean))]
}

function buildFtsQuery(text: string): string {
  return getSearchTerms(text)
    .map((term) => `"${term.replaceAll('"', '""')}"`)
    .join(' AND ')
}

function escapeLike(text: string): string {
  return text.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

function stripSnippetMarkers(snippet: string): {
  snippet: string
  highlights: SessionSearchHighlight[]
} {
  const highlights: SessionSearchHighlight[] = []
  let output = ''
  let cursor = 0

  while (cursor < snippet.length) {
    const start = snippet.indexOf(SNIPPET_MARK_START, cursor)
    if (start === -1) {
      output += snippet.slice(cursor)
      break
    }

    output += snippet.slice(cursor, start)
    const matchStart = output.length
    const contentStart = start + SNIPPET_MARK_START.length
    const end = snippet.indexOf(SNIPPET_MARK_END, contentStart)
    if (end === -1) {
      output += snippet.slice(contentStart)
      break
    }

    output += snippet.slice(contentStart, end)
    highlights.push({ start: matchStart, end: output.length })
    cursor = end + SNIPPET_MARK_END.length
  }

  return { snippet: output, highlights }
}

function buildHighlights(text: string, terms: string[]): SessionSearchHighlight[] {
  const lower = text.toLocaleLowerCase()
  const ranges: SessionSearchHighlight[] = []

  for (const term of terms) {
    let cursor = 0
    while (cursor < lower.length) {
      const index = lower.indexOf(term, cursor)
      if (index === -1) break
      ranges.push({ start: index, end: index + term.length })
      cursor = index + term.length
    }
  }

  return ranges
    .sort((a, b) => a.start - b.start || b.end - a.end)
    .reduce<SessionSearchHighlight[]>((merged, range) => {
      const previous = merged.at(-1)
      if (previous && range.start <= previous.end) {
        previous.end = Math.max(previous.end, range.end)
      } else {
        merged.push({ ...range })
      }
      return merged
    }, [])
}

function buildFallbackSnippet(
  content: string,
  terms: string[]
): {
  snippet: string
  highlights: SessionSearchHighlight[]
} {
  const lower = content.toLocaleLowerCase()
  const firstIndex = terms.reduce((best, term) => {
    const index = lower.indexOf(term)
    if (index === -1) return best
    return best === -1 ? index : Math.min(best, index)
  }, -1)

  const start = firstIndex === -1 ? 0 : Math.max(0, firstIndex - 80)
  const end = Math.min(content.length, start + 220)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < content.length ? '...' : ''
  const snippet = `${prefix}${content.slice(start, end)}${suffix}`
  return { snippet, highlights: buildHighlights(snippet, terms) }
}

function displayContentForRow(row: RawSearchRow): string {
  if (row.role === 'tool') {
    const value = row.toolCallResult || row.content || ''
    return row.toolName ? `${row.toolName}: ${value}` : value
  }
  return row.content || ''
}

function toSearchResult(row: RawSearchRow, terms: string[]): SessionSearchResult {
  const content = displayContentForRow(row)
  const markedSnippet = row.snippet?.trim()
  const parsedSnippet = markedSnippet
    ? stripSnippetMarkers(markedSnippet)
    : buildFallbackSnippet(row.role === 'session' ? row.title : content, terms)

  return {
    sessionId: row.sessionId,
    title: row.title,
    cwd: row.cwd,
    sessionCreatedAt: row.sessionCreatedAt,
    sessionUpdatedAt: row.sessionUpdatedAt,
    messageId: row.messageId,
    role: row.role,
    content,
    snippet: parsedSnippet.snippet,
    highlights: parsedSnippet.highlights,
    sortOrder: row.sortOrder,
    messageCreatedAt: row.messageCreatedAt,
    toolName: row.toolName
  }
}

export function searchSessionMessages(query: SessionSearchQuery): SessionSearchResult[] {
  const text = query.text.trim()
  if (text.length < MIN_SEARCH_QUERY_LENGTH) return []

  const limit = clampSearchLimit(query.limit)
  const terms = getSearchTerms(text)
  if (terms.length === 0) return []

  const likeQuery = `%${escapeLike(text.toLocaleLowerCase())}%`
  const rows: RawSearchRow[] = []

  const titleRows = sqlite()
    .prepare(`
      SELECT
        s.session_id AS sessionId,
        s.title AS title,
        s.cwd AS cwd,
        s.created_at AS sessionCreatedAt,
        s.updated_at AS sessionUpdatedAt,
        NULL AS messageId,
        'session' AS role,
        s.title AS content,
        NULL AS snippet,
        NULL AS sortOrder,
        NULL AS messageCreatedAt,
        NULL AS toolName,
        NULL AS toolCallResult
      FROM sessions s
      WHERE s.archived_at IS NULL
        AND s.session_kind = 'main'
        AND (
          lower(s.title) LIKE ? ESCAPE '\\'
          OR lower(s.cwd) LIKE ? ESCAPE '\\'
        )
      ORDER BY
        CASE WHEN lower(s.title) = ? THEN 0 ELSE 1 END,
        s.updated_at DESC
      LIMIT ?
    `)
    .all(likeQuery, likeQuery, text.toLocaleLowerCase(), limit) as RawSearchRow[]

  rows.push(...titleRows)

  const ftsQuery = buildFtsQuery(text)
  if (ftsQuery) {
    const ftsRows = sqlite()
      .prepare(`
        SELECT
          s.session_id AS sessionId,
          s.title AS title,
          s.cwd AS cwd,
          s.created_at AS sessionCreatedAt,
          s.updated_at AS sessionUpdatedAt,
          m.id AS messageId,
          m.role AS role,
          m.content AS content,
          snippet(messages_fts, 3, ?, ?, '...', 24) AS snippet,
          m.sort_order AS sortOrder,
          m.created_at AS messageCreatedAt,
          m.tool_name AS toolName,
          m.tool_call_result AS toolCallResult
        FROM messages_fts
        JOIN messages m ON m.rowid = messages_fts.rowid
        JOIN sessions s ON s.session_id = m.session_id
        WHERE messages_fts MATCH ?
          AND s.archived_at IS NULL
          AND s.session_kind = 'main'
          AND m.visibility IN ('shared', 'ui-only')
        ORDER BY
          CASE m.role
            WHEN 'user' THEN 0
            WHEN 'assistant' THEN 1
            WHEN 'system' THEN 2
            ELSE 3
          END,
          bm25(messages_fts),
          s.updated_at DESC
        LIMIT ?
      `)
      .all(SNIPPET_MARK_START, SNIPPET_MARK_END, ftsQuery, limit) as RawSearchRow[]

    rows.push(...ftsRows)
  }

  const likeRows = sqlite()
    .prepare(`
      SELECT
        s.session_id AS sessionId,
        s.title AS title,
        s.cwd AS cwd,
        s.created_at AS sessionCreatedAt,
        s.updated_at AS sessionUpdatedAt,
        m.id AS messageId,
        m.role AS role,
        m.content AS content,
        NULL AS snippet,
        m.sort_order AS sortOrder,
        m.created_at AS messageCreatedAt,
        m.tool_name AS toolName,
        m.tool_call_result AS toolCallResult
      FROM messages m
      JOIN sessions s ON s.session_id = m.session_id
      WHERE s.archived_at IS NULL
        AND lower(
        coalesce(m.content, '') || ' ' ||
        coalesce(m.tool_name, '') || ' ' ||
        coalesce(m.tool_call_result, '')
      ) LIKE ? ESCAPE '\\'
        AND s.session_kind = 'main'
        AND m.visibility IN ('shared', 'ui-only')
      ORDER BY
        CASE m.role
          WHEN 'user' THEN 0
          WHEN 'assistant' THEN 1
          WHEN 'system' THEN 2
          ELSE 3
        END,
        s.updated_at DESC,
        m.sort_order ASC
      LIMIT ?
    `)
    .all(likeQuery, limit) as RawSearchRow[]

  rows.push(...likeRows)

  const seen = new Set<string>()
  const results: SessionSearchResult[] = []
  for (const row of rows) {
    const key = row.messageId ? `message:${row.messageId}` : `session:${row.sessionId}`
    if (seen.has(key)) continue
    seen.add(key)
    results.push(toSearchResult(row, terms))
    if (results.length >= limit) break
  }

  return results
}

export function getNextSortOrder(sessionId: string): number {
  const last = db()
    .select({ sortOrder: messages.sortOrder })
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(desc(messages.sortOrder))
    .limit(1)
    .get()
  return last ? last.sortOrder + 1 : 0
}
