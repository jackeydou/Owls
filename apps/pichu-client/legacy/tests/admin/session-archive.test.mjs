import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

function canLoadBetterSqlite3() {
  try {
    const require = globalThis.process.getBuiltinModule('module').createRequire(import.meta.url)
    const Database = require('better-sqlite3')
    const db = new Database(':memory:')
    db.close()
    return true
  } catch {
    return false
  }
}

const sqliteAvailable = canLoadBetterSqlite3()

async function importSource(path) {
  return import(`${pathToFileURL(path).href}?ts=${Date.now()}`)
}

async function loadSettingsStoreForTest() {
  const moduleDir = mkdtempSync(join(tmpdir(), 'pichu-session-archive-store-'))
  const mainDir = join(moduleDir, 'main')
  const storesDir = join(mainDir, 'stores')
  const dbDir = join(mainDir, 'db')
  const sharedDir = join(moduleDir, 'shared')
  const agentDir = join(mainDir, 'agent')
  const featureGatesDir = join(mainDir, 'feature-gates')
  const pluginsDir = join(mainDir, 'plugins')

  for (const dir of [storesDir, dbDir, sharedDir, agentDir, featureGatesDir, pluginsDir]) {
    mkdirSync(dir, { recursive: true })
  }
  symlinkSync(
    new URL('../../node_modules', import.meta.url),
    join(moduleDir, 'node_modules'),
    'dir'
  )

  const settingsStoreSource = readFileSync(
    new URL('../../src/main/stores/settings-store.ts', import.meta.url),
    'utf8'
  )
    .replace("import { app } from 'electron'\n", "const app = { getVersion: () => '0.0.0' }\n")
    .replaceAll(
      '../../shared/agent-message-visibility.js',
      '../../shared/agent-message-visibility.ts'
    )
    .replaceAll('../../shared/artifacts.js', '../../shared/artifacts.ts')
    .replaceAll('../../shared/build-mode.js', '../../shared/build-mode.ts')
    .replaceAll('../../shared/message-parts.js', '../../shared/message-parts.ts')
    .replaceAll('../../shared/model-settings.js', '../../shared/model-settings.ts')
    .replaceAll('../../shared/model-trajectory.js', '../../shared/model-trajectory.ts')
    .replaceAll('../../shared/runtime-delivery.js', '../../shared/runtime-delivery.ts')
    .replaceAll('../../shared/tool-approval.js', '../../shared/tool-approval.ts')
    .replaceAll('../agent/pi-models.js', '../agent/pi-models.ts')
    .replaceAll('../db/index.js', '../db/index.ts')
    .replaceAll('../db/schema.js', '../db/schema.ts')
    .replaceAll('../dev-app-instance.js', '../dev-app-instance.ts')
    .replaceAll(
      '../feature-gates/local-feature-gate-service.js',
      '../feature-gates/local-feature-gate-service.ts'
    )
    .replaceAll('../pichu-paths.js', '../pichu-paths.ts')
    .replaceAll('../plugins/plugin-exposure.js', '../plugins/plugin-exposure.ts')
    .replaceAll('../plugins/plugin-registry.js', '../plugins/plugin-registry.ts')
    .replaceAll('../plugins/use-plugin-status.js', '../plugins/use-plugin-status.ts')

  for (const file of [
    'agent-message-visibility.ts',
    'artifacts.ts',
    'message-parts.ts',
    'model-settings.ts',
    'model-trajectory.ts',
    'runtime-delivery.ts',
    'tool-approval.ts'
  ]) {
    writeFileSync(
      join(sharedDir, file),
      readFileSync(new URL(`../../src/shared/${file}`, import.meta.url), 'utf8'),
      'utf8'
    )
  }
  writeFileSync(join(sharedDir, 'build-mode.ts'), `export const isDebugPackage = false\n`, 'utf8')
  writeFileSync(
    join(dbDir, 'schema.ts'),
    readFileSync(new URL('../../src/main/db/schema.ts', import.meta.url), 'utf8'),
    'utf8'
  )
  writeFileSync(
    join(agentDir, 'pi-models.ts'),
    `export function defaultThinkingLevelForModelId() { return null }\n`,
    'utf8'
  )
  writeFileSync(
    join(mainDir, 'dev-app-instance.ts'),
    `export function getDevAppInstanceInfo() { return null }\n`,
    'utf8'
  )
  writeFileSync(
    join(featureGatesDir, 'local-feature-gate-service.ts'),
    `export function pruneUnknownFeatureGateSettings() {}\n`,
    'utf8'
  )
  writeFileSync(
    join(mainDir, 'pichu-paths.ts'),
    `
export function applyNewDataRoot() { return 'unchanged' }
export function defaultWorkspaceRoot() { return '/tmp/pichu-workspace' }
export function ensureDataRootDir() {}
export function getDataRoot() { return '/tmp/pichu-data' }
export function resolvePichuPath(path) { return path }
export function writeBootstrapIfMissing() {}
    `,
    'utf8'
  )
  writeFileSync(
    join(pluginsDir, 'plugin-exposure.ts'),
    `export const COMPUTER_USE_PLUGIN_NAME = 'computer-use'\nexport function isPluginHiddenFromUsers() { return false }\n`,
    'utf8'
  )
  writeFileSync(
    join(pluginsDir, 'plugin-registry.ts'),
    `export function isInstalledPluginEnabled() { return false }\n`,
    'utf8'
  )
  writeFileSync(
    join(pluginsDir, 'use-plugin-status.ts'),
    `export const COMPUTER_USE_PLUGIN_NAME = 'computer-use'\n`,
    'utf8'
  )
  writeFileSync(join(storesDir, 'settings-store.ts'), settingsStoreSource, 'utf8')
  writeFileSync(
    join(dbDir, 'index.ts'),
    `
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.ts'

const sqliteDb = new Database(':memory:')
sqliteDb.pragma('foreign_keys = ON')
sqliteDb.exec(\`
CREATE TABLE settings (
  key text PRIMARY KEY,
  value text NOT NULL
);
CREATE TABLE sessions (
  session_id text PRIMARY KEY NOT NULL,
  agent_id text NOT NULL,
  cwd text NOT NULL,
  title text NOT NULL DEFAULT '',
  session_kind text NOT NULL DEFAULT 'main',
  parent_session_id text REFERENCES sessions(session_id) ON DELETE cascade,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  archived_at text,
  pinned integer NOT NULL DEFAULT 0,
  pinned_order integer NOT NULL DEFAULT 0,
  session_model_id text,
  session_thinking_level text,
  session_model_updated_at text,
  session_model_updated_by text,
  shared_session_url text,
  shared_session_source_updated_at text
);
CREATE TABLE agent_runs (
  id text PRIMARY KEY NOT NULL,
  session_id text NOT NULL REFERENCES sessions(session_id) ON DELETE cascade,
  status text NOT NULL,
  started_at text NOT NULL,
  completed_at text,
  duration_ms integer,
  error text,
  requested_model_id text,
  requested_thinking_level text,
  effective_model_id text,
  effective_thinking_level text,
  effective_reason text
);
CREATE TABLE messages (
  id text PRIMARY KEY NOT NULL,
  session_id text NOT NULL REFERENCES sessions(session_id) ON DELETE cascade,
  run_id text REFERENCES agent_runs(id) ON DELETE set null,
  role text NOT NULL,
  kind text NOT NULL DEFAULT 'default',
  content text NOT NULL,
  agent_content text NOT NULL DEFAULT '',
  visibility text NOT NULL DEFAULT 'shared',
  sort_order integer NOT NULL,
  created_at text NOT NULL,
  tool_call_id text,
  tool_name text,
  tool_call_result text,
  attachments_json text,
  model_id text,
  model_provider text,
  model_api text,
  model_usage_json text
);
CREATE TABLE message_parts (
  id text PRIMARY KEY NOT NULL,
  message_id text NOT NULL REFERENCES messages(id) ON DELETE cascade,
  session_id text NOT NULL REFERENCES sessions(session_id) ON DELETE cascade,
  position integer NOT NULL,
  type text NOT NULL,
  data_json text NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE TABLE artifacts (
  id text PRIMARY KEY NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  payload_json text NOT NULL,
  source_session_id text REFERENCES sessions(session_id) ON DELETE set null,
  source_message_id text REFERENCES messages(id) ON DELETE set null,
  source_tool_call_id text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE VIRTUAL TABLE messages_fts USING fts5(
  message_id UNINDEXED,
  session_id UNINDEXED,
  role UNINDEXED,
  searchable_text,
  tokenize = 'unicode61'
);
CREATE TRIGGER messages_fts_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, message_id, session_id, role, searchable_text)
  VALUES (
    new.rowid,
    new.id,
    new.session_id,
    new.role,
    trim(
      coalesce(new.content, '') || ' ' ||
      coalesce(new.tool_name, '') || ' ' ||
      coalesce(new.tool_call_result, '')
    )
  );
END;
CREATE TRIGGER messages_fts_ad AFTER DELETE ON messages BEGIN
  DELETE FROM messages_fts WHERE rowid = old.rowid;
END;
CREATE TRIGGER messages_fts_au AFTER UPDATE ON messages BEGIN
  DELETE FROM messages_fts WHERE rowid = old.rowid;
  INSERT INTO messages_fts(rowid, message_id, session_id, role, searchable_text)
  VALUES (
    new.rowid,
    new.id,
    new.session_id,
    new.role,
    trim(
      coalesce(new.content, '') || ' ' ||
      coalesce(new.tool_name, '') || ' ' ||
      coalesce(new.tool_call_result, '')
    )
  );
END;
\`)

const drizzleDb = drizzle(sqliteDb, { schema })
export function db() { return drizzleDb }
export function initDatabase() {}
export function sqlite() { return sqliteDb }
    `,
    'utf8'
  )

  try {
    return {
      moduleDir,
      store: await importSource(join(storesDir, 'settings-store.ts')),
      db: await importSource(join(dbDir, 'index.ts'))
    }
  } catch (error) {
    rmSync(moduleDir, { recursive: true, force: true })
    throw error
  }
}

async function loadSessionActionsForTest() {
  const moduleDir = mkdtempSync(join(tmpdir(), 'pichu-session-actions-'))
  const rendererDir = join(moduleDir, 'renderer', 'src')
  const sessionDir = join(rendererDir, 'stores', 'session')
  const storesDir = join(rendererDir, 'stores')
  const libDir = join(rendererDir, 'lib')

  for (const dir of [sessionDir, storesDir, libDir]) {
    mkdirSync(dir, { recursive: true })
  }
  symlinkSync(
    new URL('../../node_modules', import.meta.url),
    join(moduleDir, 'node_modules'),
    'dir'
  )

  const sessionActionsSource = readFileSync(
    new URL('../../src/renderer/src/stores/session/session-actions.ts', import.meta.url),
    'utf8'
  )
    .replaceAll('../embedded-browser-store', '../embedded-browser-store.ts')
    .replaceAll('./messages', './messages.ts')
    .replaceAll('./session-files', './session-files.ts')
    .replaceAll('./session-index', './session-index.ts')
    .replaceAll('./session-status', './session-status.ts')
    .replaceAll('./types', './types.ts')

  writeFileSync(join(sessionDir, 'session-actions.ts'), sessionActionsSource, 'utf8')
  writeFileSync(
    join(sessionDir, 'session-index.ts'),
    readFileSync(
      new URL('../../src/renderer/src/stores/session/session-index.ts', import.meta.url),
      'utf8'
    ).replaceAll('./types', './types.ts'),
    'utf8'
  )
  writeFileSync(
    join(sessionDir, 'session-status.ts'),
    readFileSync(
      new URL('../../src/renderer/src/stores/session/session-status.ts', import.meta.url),
      'utf8'
    ).replaceAll('./types', './types.ts'),
    'utf8'
  )
  writeFileSync(join(sessionDir, 'types.ts'), `export {}\n`, 'utf8')
  writeFileSync(
    join(sessionDir, 'messages.ts'),
    `export function buildLoadedSessionView() { return { messages: [], widgets: new Map() } }
export function mergeLoadedAndLiveMessages(loaded) { return loaded }
`,
    'utf8'
  )
  writeFileSync(
    join(sessionDir, 'session-files.ts'),
    `export function mergeSessionDirectoryEntries() { return [] }
export function normalizeSessionFileDirectory(directory = '') { return directory.trim() }
`,
    'utf8'
  )
  writeFileSync(
    join(storesDir, 'embedded-browser-store.ts'),
    `export const useEmbeddedBrowserStore = { getState: () => ({ resetDraft() {} }) }\n`,
    'utf8'
  )

  try {
    return {
      moduleDir,
      actions: await importSource(join(sessionDir, 'session-actions.ts'))
    }
  } catch (error) {
    rmSync(moduleDir, { recursive: true, force: true })
    throw error
  }
}

function makeSession(overrides = {}) {
  return {
    sessionId: 'session_1',
    agentId: 'pi-agent',
    cwd: '/tmp/project',
    title: 'Active session',
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-01T12:00:00.000Z',
    ...overrides
  }
}

function makeMessage(overrides = {}) {
  return {
    id: 'message_1',
    sessionId: 'session_1',
    role: 'user',
    kind: 'default',
    content: 'needle message',
    agentContent: '',
    visibility: 'shared',
    sortOrder: 1,
    createdAt: '2026-06-01T12:00:00.000Z',
    ...overrides
  }
}

async function withSettingsStore(fn) {
  const loaded = await loadSettingsStoreForTest()
  try {
    return await fn(loaded)
  } finally {
    loaded.db.sqlite().close()
    rmSync(loaded.moduleDir, { recursive: true, force: true })
  }
}

test(
  'archive hides sessions from active index and search without changing updatedAt',
  { skip: !sqliteAvailable },
  async () =>
    withSettingsStore(({ store }) => {
      const activeSession = makeSession({
        sessionId: 'active_session',
        title: 'Active Search Needle',
        updatedAt: '2026-06-03T12:00:00.000Z'
      })
      const archivedSession = makeSession({
        sessionId: 'archived_session',
        title: 'Archived Search Needle',
        updatedAt: '2026-06-02T12:00:00.000Z'
      })

      store.addSessionToIndex(activeSession)
      store.addSessionToIndex(archivedSession)
      store.addMessage(
        makeMessage({
          id: 'active_message',
          sessionId: activeSession.sessionId,
          content: 'visible active needle'
        })
      )
      store.addMessage(
        makeMessage({
          id: 'archived_message',
          sessionId: archivedSession.sessionId,
          content: 'hidden archived needle'
        })
      )

      const archivedBefore = store.getSessionById(archivedSession.sessionId)
      store.archiveSessionInIndex(archivedSession.sessionId)

      const archived = store.getSessionById(archivedSession.sessionId)
      assert.equal(archived.updatedAt, archivedBefore.updatedAt)
      assert.ok(archived.archivedAt)
      assert.deepEqual(
        store.getSessionIndex().map((entry) => entry.sessionId),
        [activeSession.sessionId]
      )
      assert.deepEqual(
        store.getArchivedSessionIndex().map((entry) => entry.sessionId),
        [archivedSession.sessionId]
      )
      assert.deepEqual(
        store.searchSessionMessages({ text: 'archived needle' }).map((entry) => entry.sessionId),
        []
      )
      assert.ok(
        store
          .searchSessionMessages({ text: 'active needle' })
          .some((entry) => entry.sessionId === activeSession.sessionId)
      )

      store.unarchiveSessionInIndex(archivedSession.sessionId)

      const restored = store.getSessionById(archivedSession.sessionId)
      assert.equal(restored.archivedAt, null)
      assert.equal(restored.updatedAt, archivedBefore.updatedAt)
      assert.ok(
        store.getSessionIndex().some((entry) => entry.sessionId === archivedSession.sessionId)
      )
      assert.ok(
        store
          .searchSessionMessages({ text: 'archived needle' })
          .some((entry) => entry.sessionId === archivedSession.sessionId)
      )
    })
)

test(
  'saveArtifact links streaming UI artifacts to persisted tool messages by toolCallId',
  { skip: !sqliteAvailable },
  async () =>
    withSettingsStore(({ store }) => {
      const session = makeSession()
      const toolCallId = 'streaming_tool_1'
      const html = '<style>body{margin:0}</style><div>Saved widget</div>'

      store.addSessionToIndex(session)
      store.upsertToolCallMessage({
        sessionId: session.sessionId,
        toolCallId,
        toolName: 'streamingUITool',
        args: { title: 'Saved widget', html }
      })

      const [toolMessage] = store.getSessionMessages(session.sessionId)
      assert.equal(toolMessage.toolCallId, toolCallId)
      assert.notEqual(toolMessage.id, `tool-${toolCallId}`)

      const saved = store.saveArtifact({
        kind: 'streaming-ui',
        title: 'Saved widget',
        payload: {
          toolName: 'streamingUITool',
          title: 'Saved widget',
          html
        },
        sourceSessionId: session.sessionId,
        sourceMessageId: `tool-${toolCallId}`,
        sourceToolCallId: toolCallId
      })

      assert.equal(saved.sourceSessionId, session.sessionId)
      assert.equal(saved.sourceMessageId, toolMessage.id)
      assert.equal(saved.sourceToolCallId, toolCallId)
      assert.deepEqual(
        store.listArtifacts().map((artifact) => artifact.sourceMessageId),
        [toolMessage.id]
      )
    })
)

test('archiveSession reloads the sidebar with the current sort key', async () => {
  const loaded = await loadSessionActionsForTest()
  const previousWindow = globalThis.window
  const sessionIndexSortKeys = []
  const archivedSessionIds = []
  let state = {
    sessionId: 'other_session',
    sessionLoadingId: null,
    activeSessionModel: null,
    messages: [],
    streamingAssistant: '',
    streamingThinking: false,
    pendingReconnectStatus: null,
    pendingAssistantAttachments: [],
    pendingRawEvents: [],
    queuedPrompts: [],
    busy: false,
    runningSessionIds: [],
    waitingSessionIds: [],
    activeRunIdsBySession: {},
    activeRunStartedAtsBySession: {},
    unreadSessionIds: ['target_session'],
    unreadSessionIdsLoaded: true,
    failedSessionIds: ['target_session'],
    lastError: null,
    retryPrompt: null,
    unsubscribeSession: null,
    widgets: new Map(),
    sessionIndex: [],
    sessionIndexLoaded: true,
    sessionIndexSortKey: 'created',
    filePanelOpen: false,
    sessionFiles: [],
    sessionFilesLoaded: false,
    sessionFileLoadedDirectories: [],
    sessionFileLoadingDirectories: []
  }
  const set = (partial) => {
    const next = typeof partial === 'function' ? partial(state) : partial
    state = { ...state, ...next }
  }
  const get = () => state
  const actions = loaded.actions.createSessionActions({ get, set })
  state = { ...state, ...actions }

  globalThis.window = {
    api: {
      agent: {
        sessionIndexArchive: async (sessionId) => {
          archivedSessionIds.push(sessionId)
        },
        sessionIndex: async (sortKey) => {
          sessionIndexSortKeys.push(sortKey)
          return []
        }
      }
    }
  }

  try {
    await actions.archiveSession('target_session')

    assert.deepEqual(archivedSessionIds, ['target_session'])
    assert.deepEqual(sessionIndexSortKeys, ['created'])
    assert.deepEqual(state.unreadSessionIds, [])
    assert.deepEqual(state.failedSessionIds, [])
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window
    } else {
      globalThis.window = previousWindow
    }
    rmSync(loaded.moduleDir, { recursive: true, force: true })
  }
})
