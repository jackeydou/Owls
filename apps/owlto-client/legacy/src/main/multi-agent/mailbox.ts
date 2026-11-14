import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { withFileLock } from './fs-lock.js'
import type { MailboxMessage, MailboxMessageType } from './types.js'

function inboxesDir(teamDir: string): string {
  return join(teamDir, 'inboxes')
}

function inboxPath(teamDir: string, agentName: string): string {
  return join(inboxesDir(teamDir), `${agentName}.json`)
}

function inboxLockPath(teamDir: string, agentName: string): string {
  return join(inboxesDir(teamDir), `${agentName}.lock`)
}

function now(): string {
  return new Date().toISOString()
}

export function ensureMailbox(teamDir: string, agentNames: string[] = []): void {
  mkdirSync(inboxesDir(teamDir), { recursive: true })
  for (const agentName of agentNames) {
    const path = inboxPath(teamDir, agentName)
    if (!existsSync(path)) {
      writeFileSync(path, '[]\n', 'utf8')
    }
  }
}

function readInbox(teamDir: string, agentName: string): MailboxMessage[] {
  ensureMailbox(teamDir, [agentName])
  return JSON.parse(readFileSync(inboxPath(teamDir, agentName), 'utf8')) as MailboxMessage[]
}

function writeInbox(teamDir: string, agentName: string, messages: MailboxMessage[]): void {
  writeFileSync(inboxPath(teamDir, agentName), `${JSON.stringify(messages, null, 2)}\n`, 'utf8')
}

export async function sendMessage(
  teamDir: string,
  params: {
    from: string
    to: string
    type?: MailboxMessageType
    text: string
    taskId?: string
  }
): Promise<MailboxMessage> {
  ensureMailbox(teamDir, [params.to])
  return withFileLock(inboxLockPath(teamDir, params.to), async () => {
    const messages = readInbox(teamDir, params.to)
    const message: MailboxMessage = {
      id: crypto.randomUUID(),
      from: params.from,
      to: params.to,
      type: params.type ?? 'message',
      text: params.text,
      timestamp: now(),
      read: false,
      taskId: params.taskId
    }
    messages.push(message)
    writeInbox(teamDir, params.to, messages)
    return message
  })
}

export async function broadcastMessage(
  teamDir: string,
  params: {
    from: string
    to: string[]
    text: string
    excludeSelf?: boolean
  }
): Promise<MailboxMessage[]> {
  const targets = params.excludeSelf ? params.to.filter((name) => name !== params.from) : params.to
  const messages: MailboxMessage[] = []
  for (const target of targets) {
    messages.push(
      await sendMessage(teamDir, {
        from: params.from,
        to: target,
        type: 'broadcast',
        text: params.text
      })
    )
  }
  return messages
}

export async function pollInbox(teamDir: string, agentName: string): Promise<MailboxMessage[]> {
  ensureMailbox(teamDir, [agentName])
  return withFileLock(inboxLockPath(teamDir, agentName), async () => {
    const messages = readInbox(teamDir, agentName)
    const unread = messages.filter((message) => !message.read)
    if (unread.length === 0) {
      return []
    }

    const next = messages.map((message) => ({ ...message, read: true }))
    writeInbox(teamDir, agentName, next)
    return unread
  })
}

export function listInboxMessages(teamDir: string, agentName: string): MailboxMessage[] {
  return readInbox(teamDir, agentName)
}
