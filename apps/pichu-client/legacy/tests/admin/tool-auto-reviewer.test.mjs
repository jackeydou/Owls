import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

async function loadToolAutoReviewerForTest() {
  const moduleDir = mkdtempSync(join(tmpdir(), 'pichu-tool-auto-reviewer-'))
  symlinkSync(
    new URL('../../node_modules', import.meta.url),
    join(moduleDir, 'node_modules'),
    'dir'
  )
  const source = readFileSync(
    new URL('../../src/main/tool-auto-reviewer.ts', import.meta.url),
    'utf8'
  )
    .replaceAll('./agent/pi-models.js', './pi-models.ts')
    .replace(
      'function parseAutoReviewResponse(text: string): ToolAutoReviewResult',
      'export function parseAutoReviewResponse(text: string): ToolAutoReviewResult'
    )
  writeFileSync(join(moduleDir, 'tool-auto-reviewer.ts'), source, 'utf8')
  writeFileSync(
    join(moduleDir, 'pi-models.ts'),
    `export function resolvePichuModelConfig(modelId) {
  globalThis.__pichuAutoReviewModelIds.push(modelId)
  return { id: modelId }
}
export async function completePichuText(config, context, options) {
  globalThis.__pichuAutoReviewCompleteCalls.push({ config, context, options })
  return globalThis.__pichuAutoReviewResponses.shift() ?? ''
}
`,
    'utf8'
  )
  return import(`${pathToFileURL(join(moduleDir, 'tool-auto-reviewer.ts')).href}?ts=${Date.now()}`)
}

function resetAutoReviewMocks(responses = []) {
  globalThis.__pichuAutoReviewResponses = [...responses]
  globalThis.__pichuAutoReviewModelIds = []
  globalThis.__pichuAutoReviewCompleteCalls = []
}

test('parseAutoReviewResponse accepts strict JSON', async () => {
  resetAutoReviewMocks()
  const { parseAutoReviewResponse } = await loadToolAutoReviewerForTest()

  assert.deepEqual(
    parseAutoReviewResponse(
      '{"decision":"approved","riskLevel":"low","userAuthorization":"medium","rationale":"Matches the requested edit."}'
    ),
    {
      status: 'approved',
      riskLevel: 'low',
      userAuthorization: 'medium',
      rationale: 'Matches the requested edit.'
    }
  )
})

test('parseAutoReviewResponse accepts readable non-strict model output', async () => {
  resetAutoReviewMocks()
  const { parseAutoReviewResponse } = await loadToolAutoReviewerForTest()

  assert.deepEqual(
    parseAutoReviewResponse(
      [
        'Decision: denied',
        'Risk level: critical',
        'User authorization: none',
        'Rationale: The action edits a file that was not requested.'
      ].join('\n')
    ),
    {
      status: 'denied',
      riskLevel: 'critical',
      userAuthorization: 'none',
      rationale: 'The action edits a file that was not requested.'
    }
  )
})

test('parseAutoReviewResponse accepts Codex-style outcome fields', async () => {
  resetAutoReviewMocks()
  const { parseAutoReviewResponse } = await loadToolAutoReviewerForTest()

  assert.deepEqual(
    parseAutoReviewResponse(
      '{"outcome":"allow","risk_level":"low","user_authorization":"low","rationale":"Low-risk local read-only inspection."}'
    ),
    {
      status: 'approved',
      riskLevel: 'low',
      userAuthorization: 'low',
      rationale: 'Low-risk local read-only inspection.'
    }
  )
})

test('parseAutoReviewResponse tolerates fenced JSON with minor formatting drift', async () => {
  resetAutoReviewMocks()
  const { parseAutoReviewResponse } = await loadToolAutoReviewerForTest()

  assert.deepEqual(
    parseAutoReviewResponse(
      [
        '```json',
        '{',
        '  “decision”: “denied”,',
        '  “riskLevel”: “medium”,',
        '  “userAuthorization”: “low”,',
        '  “rationale”: “Needs manual review.”,',
        '}',
        '```'
      ].join('\n')
    ),
    {
      status: 'denied',
      riskLevel: 'medium',
      userAuthorization: 'low',
      rationale: 'Needs manual review.'
    }
  )
})

test('reviewToolApprovalRequest uses the configured default model with low reasoning and retries empty responses', async () => {
  resetAutoReviewMocks([
    '',
    '{"decision":"approved","riskLevel":"low","userAuthorization":"medium","rationale":"Second attempt returned JSON."}'
  ])
  const { reviewToolApprovalRequest } = await loadToolAutoReviewerForTest()

  assert.deepEqual(
    await reviewToolApprovalRequest({
      id: 'request-1',
      sessionId: 'session-1',
      cwd: '/workspace',
      toolName: 'write',
      toolUseId: 'tool-1',
      toolInput: { path: 'data/creators.ts' },
      approvalMode: 'auto-review',
      approvalReason: 'Edit data/creators.ts?',
      description: 'Edit data/creators.ts',
      autoReviewAction: {
        type: 'applyPatch',
        files: ['data/creators.ts'],
        changes: [
          {
            path: 'data/creators.ts',
            kind: 'write',
            resolvedPath: '/workspace/data/creators.ts',
            pathScope: 'insideCwd',
            contentPreview: 'export const creators = []',
            diffPreview: [
              '--- data/creators.ts',
              '+++ data/creators.ts',
              '@@ -1,1 +1,1 @@',
              '-export const creators = oldCreators',
              '+export const creators = []'
            ].join('\n'),
            byteLength: 26,
            truncated: false
          }
        ]
      },
      source: 'chat',
      createdAt: '2026-06-17T00:00:00.000Z'
    }),
    {
      status: 'approved',
      riskLevel: 'low',
      userAuthorization: 'medium',
      rationale: 'Second attempt returned JSON.',
      reviewedActionTruncated: false
    }
  )
  assert.deepEqual(globalThis.__pichuAutoReviewModelIds, [undefined, undefined])
  assert.deepEqual(
    globalThis.__pichuAutoReviewCompleteCalls.map((call) => call.options.reasoning),
    ['low', 'low']
  )
  assert.match(
    globalThis.__pichuAutoReviewCompleteCalls[0].context.messages[0].content,
    /export const creators = \[\]/
  )
  assert.match(
    globalThis.__pichuAutoReviewCompleteCalls[0].context.messages[0].content,
    /pathScope": "insideCwd/
  )
  assert.match(
    globalThis.__pichuAutoReviewCompleteCalls[0].context.messages[0].content,
    /-export const creators = oldCreators/
  )
})

test('autoReviewPrompt preserves long action commands instead of context string truncation', async () => {
  resetAutoReviewMocks()
  const { autoReviewPrompt } = await loadToolAutoReviewerForTest()
  const targetPath = 'lib/crm-config.ts'
  const command = [
    'mkdir -p app/api/workspace/schema app/api/workspace/records app/api/video/creator',
    `cat > ${targetPath} <<'EOF'`,
    "export const BASE_TOKEN = 'YUlQbyklYa50YBsFbDYu7Bnlskd'",
    "export const TABLE_ID = 'tblhhwayTrK5yEAn'",
    ...Array.from({ length: 80 }, (_, index) => `export const FIELD_${index} = '${index}'`),
    "export const CREATOR_VIEW_ID = 'vewpXD7EE3'",
    'EOF'
  ].join('\n')

  assert.ok(command.length > 800)

  const prompt = autoReviewPrompt({
    id: 'request-long-command',
    sessionId: 'session-1',
    cwd: '/workspace',
    toolName: 'exec_command',
    toolUseId: 'tool-1',
    toolInput: { cmd: command },
    approvalMode: 'auto-review',
    approvalReason: 'Run long local write command?',
    description: `Run ${command}`,
    parsedCommand: {
      parseStatus: 'raw',
      command,
      argv: [],
      arguments: [],
      error: 'Bad substitution: '
    },
    autoReviewAction: {
      type: 'command',
      command
    },
    reviewContext: {
      assistantMessage: `context ${'x'.repeat(2_000)} context-tail`
    },
    source: 'chat',
    createdAt: '2026-06-18T00:00:00.000Z'
  })

  const actionSection = prompt.slice(prompt.indexOf('>>> APPROVAL REQUEST START'))
  assert.match(
    prompt,
    /\[1\] assistant: context x+\.{3}\[truncated 1221 chars\]\.\.\.x+ context-tail/
  )
  assert.doesNotMatch(actionSection, /\.\.\.\[truncated\]/)
  assert.match(actionSection, new RegExp(targetPath))
  assert.match(actionSection, /FIELD_79/)
  assert.match(actionSection, /CREATOR_VIEW_ID/)
  assert.doesNotMatch(actionSection, /"description":/)
  assert.doesNotMatch(actionSection, /"command": "[^"]*","command":/)
})

test('autoReviewPrompt truncates huge action strings in the middle and keeps the suffix', async () => {
  resetAutoReviewMocks()
  const { autoReviewPrompt } = await loadToolAutoReviewerForTest()
  const command = `printf '${'a'.repeat(70_000)}ACTION_SUFFIX' > generated.txt`

  const prompt = autoReviewPrompt({
    id: 'request-huge-command',
    sessionId: 'session-1',
    cwd: '/workspace',
    toolName: 'exec_command',
    toolUseId: 'tool-1',
    toolInput: { cmd: command },
    approvalMode: 'auto-review',
    description: `Run ${command}`,
    parsedCommand: {
      parseStatus: 'raw',
      command,
      argv: [],
      arguments: [],
      error: 'Command contains shell syntax.'
    },
    autoReviewAction: {
      type: 'command',
      command
    },
    source: 'chat',
    createdAt: '2026-06-18T00:00:00.000Z'
  })

  const actionSection = prompt.slice(prompt.indexOf('>>> APPROVAL REQUEST START'))
  assert.match(actionSection, /<truncated omitted_approx_tokens=\\"\d+\\" \/>/)
  assert.match(actionSection, /ACTION_SUFFIX' > generated\.txt/)
})
