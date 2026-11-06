#!/usr/bin/env node
const readline = require('node:readline')
if (process.argv.includes('--version')) {
  console.log('codex-cli fixture')
  process.exit(0)
}
const lines = readline.createInterface({ input: process.stdin })
const send = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`)
const pending = new Map()
let turn = 0
const finish = (threadId, turnId, status = 'completed') =>
  send({
    method: 'turn/completed',
    params: { threadId, turn: { id: turnId, status, error: null } }
  })
lines.on('line', (line) => {
  const frame = JSON.parse(line)
  const { id, method, params = {} } = frame
  if (!method) {
    const request = pending.get(id)
    if (request) {
      pending.delete(id)
      send({
        method: 'serverRequest/resolved',
        params: { threadId: request.threadId, requestId: id }
      })
      finish(request.threadId, request.turnId)
    }
    return
  }
  if (method === 'initialize') return send({ id, result: { userAgent: 'codex-fixture' } })
  if (method === 'initialized') return
  if (method === 'account/read')
    return send({
      id,
      result: {
        account: { type: 'chatgpt', email: 'fixture@example.com', planType: 'plus' },
        requiresOpenaiAuth: true
      }
    })
  if (method === 'model/list')
    return send({
      id,
      result: {
        data: [
          {
            model: 'fixture-model',
            displayName: 'Fixture',
            description: '',
            isDefault: true,
            hidden: false,
            defaultReasoningEffort: 'medium',
            supportedReasoningEfforts: [{ reasoningEffort: 'medium' }]
          }
        ],
        nextCursor: null
      }
    })
  if (method === 'thread/start') return send({ id, result: { thread: { id: `thread-${id}` } } })
  if (method === 'thread/resume') return send({ id, result: { thread: { id: params.threadId } } })
  if (method === 'turn/start') {
    const threadId = params.threadId
    const turnId = `turn-${process.pid}-${++turn}`
    send({ method: 'turn/started', params: { threadId, turn: { id: turnId } } })
    send({
      method: 'item/completed',
      params: {
        threadId,
        turnId,
        item: {
          id: `user-${turnId}`,
          clientId: params.clientUserMessageId,
          type: 'userMessage',
          content: params.input
        }
      }
    })
    send({ id, result: { turn: { id: turnId, status: 'inProgress' } } })
    const text = params.input[0].text
    if (text === 'approval') {
      const requestId = `approval-${turnId}`
      pending.set(requestId, { threadId, turnId })
      send({
        id: requestId,
        method: 'item/commandExecution/requestApproval',
        params: {
          threadId,
          turnId,
          itemId: `command-${turnId}`,
          command: 'echo fixture',
          reason: 'Fixture approval'
        }
      })
      return
    }
    if (text === 'long') return
    if (text === 'question') {
      const requestId = `question-${turnId}`
      pending.set(requestId, { threadId, turnId })
      send({
        id: requestId,
        method: 'item/tool/requestUserInput',
        params: {
          threadId,
          turnId,
          itemId: `question-item-${turnId}`,
          isBlocking: true,
          questions: [
            {
              id: 'approach',
              header: 'Approach',
              question: 'Which approach should I use?',
              isSecret: false,
              options: [
                { label: 'Small change', description: 'Keep the change focused.' },
                { label: 'Broader refactor', description: 'Restructure the module.' }
              ]
            }
          ]
        }
      })
      return
    }
    if (text === 'tools') {
      send({
        method: 'turn/plan/updated',
        params: {
          threadId,
          turnId,
          explanation: null,
          plan: [
            { step: 'Inspect the project', status: 'completed' },
            { step: 'Make a focused change', status: 'completed' }
          ]
        }
      })
      send({
        method: 'item/completed',
        params: {
          threadId,
          turnId,
          item: {
            id: `cmd-${turnId}`,
            type: 'commandExecution',
            command: 'pnpm test',
            status: 'completed',
            aggregatedOutput: 'All checks passed.'
          }
        }
      })
      send({
        method: 'item/completed',
        params: {
          threadId,
          turnId,
          item: {
            id: `files-${turnId}`,
            type: 'fileChange',
            status: 'completed',
            changes: [
              {
                path: 'src/example.ts',
                kind: { type: 'update' },
                diff: '+export const greeting = "hello world"'
              }
            ]
          }
        }
      })
      send({
        method: 'turn/diff/updated',
        params: {
          threadId,
          turnId,
          diff: 'diff --git a/src/example.ts b/src/example.ts\n--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n-export const greeting = "hello"\n+export const greeting = "hello world"\n'
        }
      })
    }
    send({
      method: 'item/started',
      params: { threadId, turnId, item: { id: `answer-${turnId}`, type: 'agentMessage', text: '' } }
    })
    send({
      method: 'item/agentMessage/delta',
      params: { threadId, turnId, itemId: `answer-${turnId}`, delta: 'hello ' }
    })
    send({
      method: 'item/agentMessage/delta',
      params: { threadId, turnId, itemId: `answer-${turnId}`, delta: 'world' }
    })
    send({
      method: 'item/completed',
      params: {
        threadId,
        turnId,
        item: { id: `answer-${turnId}`, type: 'agentMessage', text: 'hello world' }
      }
    })
    finish(threadId, turnId)
    return
  }
  if (method === 'turn/interrupt') {
    send({ id, result: {} })
    finish(params.threadId, params.turnId, 'interrupted')
    return
  }
  if (method === 'fixture/error')
    return send({ id, error: { code: -1, message: 'Bearer secret-token-value' } })
  if (method === 'fixture/close') return process.exit(2)
  send({ id, result: params })
})
lines.on('close', () => process.exit(0))
