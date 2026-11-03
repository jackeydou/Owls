import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test, { after } from 'node:test'
import { pathToFileURL } from 'node:url'

const moduleDir = mkdtempSync(join(tmpdir(), 'pichu-agent-hooks-test-'))
const mainDir = join(moduleDir, 'main')
const agentDir = join(mainDir, 'agent')

symlinkSync(new URL('../../node_modules', import.meta.url), join(moduleDir, 'node_modules'), 'dir')

function writeModule(relativePath, source) {
  const path = join(moduleDir, relativePath)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, source, 'utf8')
}

function copySource(relativePath, replacements = []) {
  let source = readFileSync(new URL(`../../src/${relativePath}`, import.meta.url), 'utf8')
  for (const [from, to] of replacements) {
    source = source.replaceAll(from, to)
  }
  writeModule(relativePath, source)
}

after(() => {
  rmSync(moduleDir, { recursive: true, force: true })
})

copySource('main/agent/hooks.ts', [
  ['../../shared/agent-message-visibility.js', '../../shared/agent-message-visibility.ts'],
  ['../ipc-handlers/context-compaction.js', '../ipc-handlers/context-compaction.ts'],
  ['../plugins/hooks/hook-runner.js', '../plugins/hooks/hook-runner.ts'],
  ['../tool-approval-engine.js', '../tool-approval-engine.ts'],
  ['../tool-approval-metadata.js', '../tool-approval-metadata.ts'],
  ['../tools/pichu-bash-sandbox.js', '../tools/pichu-bash-sandbox.ts'],
  ['./message-utils.js', './message-utils.ts']
])
copySource('main/tool-approval-metadata.ts', [
  ['../shared/tool-approval.js', '../shared/tool-approval.ts']
])
writeModule(
  'shared/agent-message-visibility.ts',
  [
    "export const PICHU_ASSISTANT_MESSAGE_ROLE = 'assistant'",
    "export const PICHU_CONTEXT_SUMMARY_MESSAGE_ROLE = 'context_summary'",
    "export const PICHU_USER_MESSAGE_ROLE = 'user'",
    "export function isPichuAssistantMessageRole(role) { return role === 'assistant' || role === 'pixAssistant' }",
    "export function isPichuContextSummaryMessageRole(role) { return role === 'context_summary' || role === 'pixContextSummary' }",
    "export function isPichuUserMessageRole(role) { return role === 'user' || role === 'pixUser' }"
  ].join('\n')
)
writeModule('shared/tool-approval.ts', '')
writeModule(
  'main/ipc-handlers/context-compaction.ts',
  'export function agentMessageText() { return "" }\n'
)
writeModule(
  'main/plugins/hooks/hook-runner.ts',
  [
    'export function runAgentHookEvent() { return { additionalContext: [] } }',
    'export function runPermissionRequestHooks() { return undefined }',
    'export async function runPostToolUseHooks(args) {',
    '  globalThis.__pichuAgentHookPostCalls ??= []',
    '  globalThis.__pichuAgentHookPostCalls.push(args)',
    '  return { content: [{ type: "text", text: "post hook ran" }] }',
    '}',
    'export function runPreToolUseHooks() { return undefined }'
  ].join('\n')
)
writeModule(
  'main/tool-approval-engine.ts',
  [
    'export function buildToolApprovalRequest() { return {} }',
    'export function requestToolApproval() { return { behavior: "allow" } }'
  ].join('\n')
)
writeModule(
  'main/tools/pichu-bash-sandbox.ts',
  'export function registerPichuBashSandboxEscalationForApproval() {}\n'
)
writeModule(
  'main/agent/message-utils.ts',
  'export function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value) }\n'
)

const hooks = await import(`${pathToFileURL(join(agentDir, 'hooks.ts')).href}?ts=${Date.now()}`)

function resetPostCalls() {
  globalThis.__pichuAgentHookPostCalls = []
}

function afterContext({ toolName, toolUseId = 'tool-actual', args = {}, result }) {
  return {
    sessionId: 'session-1',
    cwd: moduleDir,
    model: 'test-model',
    context: {
      toolCall: { id: toolUseId, name: toolName },
      args,
      result,
      isError: false,
      context: { tools: [{ name: toolName }] }
    }
  }
}

test('runAfterToolCallHooks runs normal hooks for managed exec_command start', async () => {
  resetPostCalls()
  const result = {
    content: [{ type: 'text', text: 'Process running with session ID 123' }],
    details: {
      hookToolName: 'exec_command',
      hookToolUseId: 'tool-actual',
      hookInput: { cmd: 'pnpm dev' },
      sessionId: '123'
    }
  }

  await hooks.runAfterToolCallHooks(
    afterContext({
      toolName: 'exec_command',
      args: { cmd: 'pnpm dev' },
      result
    })
  )

  assert.equal(globalThis.__pichuAgentHookPostCalls.length, 1)
  assert.equal(globalThis.__pichuAgentHookPostCalls[0].toolName, 'exec_command')
  assert.equal(globalThis.__pichuAgentHookPostCalls[0].toolUseId, 'tool-actual')
  assert.deepEqual(globalThis.__pichuAgentHookPostCalls[0].toolInput, { cmd: 'pnpm dev' })
  assert.equal(globalThis.__pichuAgentHookPostCalls[0].toolResponse, result)
})

test('runAfterToolCallHooks skips write_stdin transport without completion response', async () => {
  resetPostCalls()

  const decision = await hooks.runAfterToolCallHooks(
    afterContext({
      toolName: 'write_stdin',
      toolUseId: 'poll-1',
      args: { session_id: '123' },
      result: {
        details: {
          hookToolName: 'exec_command',
          hookToolUseId: 'exec-1',
          hookInput: { cmd: 'pnpm dev' }
        }
      }
    })
  )

  assert.equal(decision, undefined)
  assert.equal(globalThis.__pichuAgentHookPostCalls.length, 0)
})

test('runAfterToolCallHooks falls back to normal hooks for non-managed write_stdin results', async () => {
  resetPostCalls()

  await hooks.runAfterToolCallHooks(
    afterContext({
      toolName: 'write_stdin',
      toolUseId: 'poll-standalone',
      args: { session_id: '123' },
      result: {
        content: [{ type: 'text', text: 'standalone output' }]
      }
    })
  )

  assert.equal(globalThis.__pichuAgentHookPostCalls.length, 1)
  assert.equal(globalThis.__pichuAgentHookPostCalls[0].toolName, 'write_stdin')
  assert.equal(globalThis.__pichuAgentHookPostCalls[0].toolUseId, 'poll-standalone')
  assert.deepEqual(globalThis.__pichuAgentHookPostCalls[0].toolInput, { session_id: '123' })
})

test('runAfterToolCallHooks synthesizes original exec_command hook for write_stdin completion', async () => {
  resetPostCalls()

  await hooks.runAfterToolCallHooks(
    afterContext({
      toolName: 'write_stdin',
      toolUseId: 'poll-2',
      args: { session_id: '123' },
      result: {
        details: {
          hookToolName: 'exec_command',
          hookToolUseId: 'exec-1',
          hookInput: { cmd: 'pnpm dev' },
          hookResponse: 'ready on 3000'
        }
      }
    })
  )

  assert.equal(globalThis.__pichuAgentHookPostCalls.length, 1)
  assert.equal(globalThis.__pichuAgentHookPostCalls[0].toolName, 'exec_command')
  assert.equal(globalThis.__pichuAgentHookPostCalls[0].toolUseId, 'exec-1')
  assert.deepEqual(globalThis.__pichuAgentHookPostCalls[0].toolInput, { cmd: 'pnpm dev' })
  assert.equal(globalThis.__pichuAgentHookPostCalls[0].toolResponse, 'ready on 3000')
})
