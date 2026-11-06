import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const {
  CodexClient,
  discoverExecutable,
  normalizeItem,
  parseModels
} = require('../out/main/codex/runtime.js')
const directory = realpathSync(mkdtempSync(join(tmpdir(), 'owls-codex-live-')))
const useTools = process.argv.includes('--tools')
const completedItems = []
let complete
let rejectTurn
const done = new Promise((resolve, reject) => {
  complete = resolve
  rejectTurn = reject
})
let output = ''
let eventCount = 0
const client = new CodexClient(
  (frame) => {
    eventCount++
    if (frame.method === 'item/agentMessage/delta') output += frame.params?.delta ?? ''
    if (frame.method === 'item/completed' && frame.params?.item?.type === 'agentMessage') {
      output = frame.params.item.text
    }
    if (frame.method === 'item/completed') {
      completedItems.push(normalizeItem(frame.params.item, frame.params.turnId ?? null, true))
    }
    if (frame.method === 'turn/completed') complete(frame.params.turn)
    if (frame.id !== undefined) client.reject(frame.id)
  },
  (reason) => rejectTurn?.(new Error(reason))
)
let timeout
try {
  await client.start(discoverExecutable(null))
  const account = await client.request('account/read', { refreshToken: false })
  const models = parseModels(
    await client.request('model/list', { limit: 100, includeHidden: false })
  )
  console.log(
    JSON.stringify({
      connected: true,
      accountKind: account.account?.type ?? 'external-or-signed-out',
      hasAccount: account.account !== null,
      availableModels: models.length
    })
  )
  if (process.argv.includes('--prompt') || useTools) {
    const response = await client.request('thread/start', {
      cwd: directory,
      ephemeral: true,
      approvalPolicy: 'never',
      sandbox: useTools ? 'workspace-write' : 'read-only'
    })
    timeout = setTimeout(
      () => rejectTurn(new Error('Live Codex turn did not finish within 90 seconds.')),
      90_000
    )
    await client.request('turn/start', {
      threadId: response.thread.id,
      input: [
        {
          type: 'text',
          text: useTools
            ? 'Use apply_patch to create hello.txt in the current directory containing exactly OWLS_CODEX_OK followed by a newline. Then run cat hello.txt to verify it. Finally reply exactly OWLS_CODEX_OK.'
            : 'Reply exactly OWLS_CODEX_OK. Do not use any tools.',
          text_elements: []
        }
      ]
    })
    const turn = await done
    assert.equal(turn.status, 'completed')
    assert.match(output, /OWLS_CODEX_OK/)
    if (useTools) {
      assert.equal(readFileSync(join(directory, 'hello.txt'), 'utf8'), 'OWLS_CODEX_OK\n')
      assert.ok(
        completedItems.some((item) => item.kind === 'files'),
        'Expected a native file-change item'
      )
      assert.ok(
        completedItems.some((item) => item.kind === 'command'),
        'Expected a native command item'
      )
    }
    console.log(
      JSON.stringify({
        liveTurn: 'passed',
        streamedEvents: eventCount,
        matchedExpectedOutput: true,
        nativeFileAndCommandVerified: useTools
      })
    )
  }
} finally {
  clearTimeout(timeout)
  rejectTurn = null
  client.stop()
  rmSync(directory, { recursive: true, force: true })
}
