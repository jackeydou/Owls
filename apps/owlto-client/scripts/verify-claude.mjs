import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk/core'

// Live check against the locally installed Claude Code CLI. The default run
// only starts the CLI to read its model catalog and account; --prompt and
// --tools send small model requests inside a temporary directory.
const require = createRequire(import.meta.url)
const { ClaudeService } = require('../out/main/app/runtime.js')
const directory = realpathSync(mkdtempSync(join(tmpdir(), 'owlto-claude-live-')))
const useTools = process.argv.includes('--tools')
const usePrompt = useTools || process.argv.includes('--prompt')
const sessions = new Map()
const store = {
  settings: () => ({
    executablePath: null,
    model: null,
    effort: null,
    permission: 'workspace-write',
    theme: 'system',
    language: 'en',
    provider: 'claude-code',
    claudeExecutablePath: null,
    claudeModel: null,
    claudeEffort: null
  }),
  sessions: () => [...sessions.values()],
  saveSession: (session) => sessions.set(session.id, structuredClone(session)),
  removeSession: (id) => sessions.delete(id),
  projects: () => [{ id: 'live', name: 'live', path: directory }],
  acceptCommand: () => true
}
const service = new ClaudeService(store, () => {}, { query })
async function finish(sessionId, approve) {
  const deadline = Date.now() + 120_000
  while (true) {
    const session = service.sessionList().find((s) => s.id === sessionId)
    if (!['starting', 'running', 'waiting'].includes(session.status)) return session
    for (const request of session.requests.filter((r) => r.status === 'pending')) {
      assert.ok(approve, `Unexpected approval request: ${request.kind}`)
      service.respond({ sessionId, requestId: request.id, decision: 'accept' })
    }
    assert.ok(Date.now() < deadline, 'Live Claude Code turn did not finish within 120 seconds.')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}
try {
  const connection = await service.connect()
  assert.equal(connection.status, 'ready', JSON.stringify(connection.error))
  console.log(
    JSON.stringify({
      connected: true,
      version: connection.version,
      accountKind: connection.account.kind,
      availableModels: connection.models.length,
      autoModeModels: connection.models.filter((m) => m.autoMode).length
    })
  )
  if (usePrompt) {
    const session = service.createSession({
      provider: 'claude-code',
      cwd: directory,
      model: null,
      effort: null,
      permission: useTools ? 'workspace-write' : 'read-only'
    })
    await service.send({
      sessionId: session.id,
      commandId: crypto.randomUUID(),
      text: useTools
        ? 'Use the Write tool to create hello.txt in the current directory containing exactly OWLTO_CLAUDE_OK followed by a newline. Then run cat hello.txt with Bash to verify it. Finally reply exactly OWLTO_CLAUDE_OK.'
        : 'Reply exactly OWLTO_CLAUDE_OK. Do not use any tools.'
    })
    const done = await finish(session.id, useTools)
    assert.equal(
      done.status,
      'idle',
      JSON.stringify({
        error: done.error,
        items: done.items.map((i) => [i.kind, i.status, i.text.slice(0, 60)])
      })
    )
    const reply = done.items.filter((i) => i.kind === 'assistant').at(-1)?.text ?? ''
    assert.match(reply, /OWLTO_CLAUDE_OK/)
    assert.ok(done.threadId, 'Expected a native Claude Code session id')
    if (useTools) {
      assert.equal(readFileSync(join(directory, 'hello.txt'), 'utf8'), 'OWLTO_CLAUDE_OK\n')
      assert.ok(
        done.items.some((i) => i.kind === 'files'),
        'Expected a file-change item'
      )
      assert.ok(
        done.items.some((i) => i.kind === 'command'),
        'Expected a command item'
      )
      assert.ok(done.diff.includes('+OWLTO_CLAUDE_OK'), 'Expected the turn diff')
    }
    await service.send({
      sessionId: session.id,
      commandId: crypto.randomUUID(),
      text: 'Reply exactly OWLTO_CLAUDE_RESUMED. Do not use any tools.'
    })
    const resumed = await finish(session.id, false)
    assert.equal(resumed.status, 'idle', JSON.stringify(resumed.error))
    assert.equal(resumed.threadId, done.threadId, 'Expected the native session to resume')
    console.log(
      JSON.stringify({
        liveTurn: 'passed',
        items: done.items.length,
        tokens: resumed.tokens,
        resumedNativeSession: true,
        nativeFileAndCommandVerified: useTools
      })
    )
  }
} finally {
  service.close()
  rmSync(directory, { recursive: true, force: true })
}
