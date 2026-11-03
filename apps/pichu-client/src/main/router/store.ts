import { asc, desc, eq, max } from 'drizzle-orm'
import { type CodexRouter, routerSchema } from '../../shared/codex.js'
import { type RouterWorker, workerSchema } from '../../shared/router.js'
import {
  codexCredentials,
  codexRouterMessages,
  codexRouters,
  codexWorkers
} from '../codex/schema.js'
import type { CodexStore } from '../codex/store.js'

/** Router persistence in `owls-codex.db`, sharing the Codex store's connection. */
export class RouterStore {
  constructor(private readonly store: CodexStore) {}
  private get db() {
    return this.store.db
  }
  routers(): CodexRouter[] {
    return this.db
      .select()
      .from(codexRouters)
      .all()
      .map((row) => routerSchema.parse(row.value))
      .sort((a, b) => a.projectId.localeCompare(b.projectId))
  }
  saveRouter(value: CodexRouter): void {
    const router = routerSchema.parse(value)
    this.db
      .insert(codexRouters)
      .values({ id: router.id, projectId: router.projectId, value: router })
      .onConflictDoUpdate({ target: codexRouters.id, set: { value: router } })
      .run()
  }
  workers(): RouterWorker[] {
    return this.db
      .select()
      .from(codexWorkers)
      .orderBy(desc(codexWorkers.updatedAt), asc(codexWorkers.id))
      .all()
      .map((row) => workerSchema.parse(row.value))
  }
  saveWorker(value: RouterWorker): void {
    const worker = workerSchema.parse(value)
    this.db
      .insert(codexWorkers)
      .values({
        id: worker.id,
        routerId: worker.routerId,
        sessionId: worker.sessionId,
        updatedAt: worker.updatedAt,
        value: worker
      })
      .onConflictDoUpdate({
        target: codexWorkers.id,
        set: { updatedAt: worker.updatedAt, value: worker }
      })
      .run()
  }
  messages(routerId: string): unknown[] {
    return this.db
      .select()
      .from(codexRouterMessages)
      .where(eq(codexRouterMessages.routerId, routerId))
      .orderBy(asc(codexRouterMessages.seq))
      .all()
      .map((row) => row.value)
  }
  appendMessages(routerId: string, batchId: string, messages: unknown[]): void {
    if (!messages.length) return
    this.db.transaction((tx) => {
      const last = tx
        .select({ seq: max(codexRouterMessages.seq) })
        .from(codexRouterMessages)
        .where(eq(codexRouterMessages.routerId, routerId))
        .get()
      let seq = last?.seq ?? -1
      for (const value of messages) {
        seq++
        tx.insert(codexRouterMessages).values({ routerId, seq, batchId, value }).run()
      }
    })
  }
  credential(providerId: string): { type: string; secret: string } | null {
    const row = this.db
      .select()
      .from(codexCredentials)
      .where(eq(codexCredentials.providerId, providerId))
      .get()
    return row ? { type: row.type, secret: row.secret } : null
  }
  credentialIds(): string[] {
    return this.db
      .select({ id: codexCredentials.providerId })
      .from(codexCredentials)
      .all()
      .map((row) => row.id)
      .sort()
  }
  saveCredential(providerId: string, type: string, secret: string): void {
    this.db
      .insert(codexCredentials)
      .values({ providerId, type, secret })
      .onConflictDoUpdate({ target: codexCredentials.providerId, set: { type, secret } })
      .run()
  }
  removeCredential(providerId: string): void {
    this.db.delete(codexCredentials).where(eq(codexCredentials.providerId, providerId)).run()
  }
}
