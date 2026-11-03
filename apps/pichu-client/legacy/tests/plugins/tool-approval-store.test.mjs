import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

async function loadToolApprovalStoreForTest() {
  const moduleDir = mkdtempSync(join(tmpdir(), 'pichu-tool-approval-store-'))
  const mainDir = join(moduleDir, 'main')
  const dbDir = join(mainDir, 'db')
  const storesDir = join(mainDir, 'stores')
  const sharedDir = join(moduleDir, 'shared')
  mkdirSync(dbDir, { recursive: true })
  mkdirSync(storesDir, { recursive: true })
  mkdirSync(sharedDir, { recursive: true })
  symlinkSync(
    new URL('../../node_modules', import.meta.url),
    join(moduleDir, 'node_modules'),
    'dir'
  )

  const storeSource = readFileSync(
    new URL('../../src/main/stores/tool-approval-store.ts', import.meta.url),
    'utf8'
  )
    .replaceAll('../../shared/tool-approval.js', '../../shared/tool-approval.ts')
    .replaceAll('../db/index.js', '../db/index.ts')
    .replaceAll('../db/schema.js', '../db/schema.ts')
    .replaceAll('../tool-approval-engine.js', '../tool-approval-engine.ts')
    .replaceAll('../tool-approval-rules.js', '../tool-approval-rules.ts')

  writeFileSync(join(storesDir, 'tool-approval-store.ts'), storeSource, 'utf8')
  writeFileSync(
    join(dbDir, 'index.ts'),
    `export function db() {
  return {
    insert() {
      return {
        values(row) {
          globalThis.__pichuToolApprovalRows.push(row)
          return { onConflictDoNothing: () => ({ run: () => undefined }) }
        }
      }
    }
  }
}
`,
    'utf8'
  )
  writeFileSync(
    join(dbDir, 'schema.ts'),
    `export const toolApprovalRequests = {
  id: 'id',
  runId: 'runId',
  sessionId: 'sessionId',
  status: 'status'
}
`,
    'utf8'
  )
  writeFileSync(
    join(sharedDir, 'tool-approval.ts'),
    readFileSync(new URL('../../src/shared/tool-approval.ts', import.meta.url), 'utf8'),
    'utf8'
  )
  writeFileSync(join(mainDir, 'tool-approval-engine.ts'), 'export {}\n', 'utf8')
  writeFileSync(
    join(mainDir, 'tool-approval-rules.ts'),
    'export function buildToolApprovalRememberRuleProposal() { return undefined }\n',
    'utf8'
  )

  try {
    globalThis.__pichuToolApprovalRows = []
    return await import(
      `${pathToFileURL(join(storesDir, 'tool-approval-store.ts')).href}?ts=${Date.now()}`
    )
  } finally {
    rmSync(moduleDir, { recursive: true, force: true })
  }
}

test('tool approval store redacts quoted secret assignments before persistence', async () => {
  const store = await loadToolApprovalStoreForTest()

  store.createToolApprovalRequest({
    request: {
      id: 'request-1',
      sessionId: 'session-1',
      cwd: '/tmp/project',
      toolName: 'exec_command',
      toolUseId: 'tool-use-1',
      toolInput: {
        command: 'TOKEN="quoted token" PASSWORD=\'quoted password\' OPENAI_API_KEY=plain-secret'
      },
      approvalMode: 'prompt',
      description: 'Run command',
      autoReviewAction: {
        type: 'command',
        command: 'TOKEN="quoted token"'
      },
      source: 'chat',
      createdAt: '2026-06-13T00:00:00.000Z'
    }
  })

  assert.equal(globalThis.__pichuToolApprovalRows.length, 1)
  const storedInput = globalThis.__pichuToolApprovalRows[0].toolInputJson
  assert.equal(storedInput.includes('quoted token'), false)
  assert.equal(storedInput.includes('quoted password'), false)
  assert.equal(storedInput.includes('plain-secret'), false)
  assert.match(storedInput, /TOKEN=\[redacted\]/)
  assert.match(storedInput, /PASSWORD=\[redacted\]/)
  assert.match(storedInput, /OPENAI_API_KEY=\[redacted\]/)
  assert.equal(
    globalThis.__pichuToolApprovalRows[0].autoReviewActionJson.includes('quoted token'),
    false
  )
})
