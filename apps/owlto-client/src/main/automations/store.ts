import { eq } from 'drizzle-orm'
import { type Automation, automationSchema } from '../../shared/automations.js'
import { automationsTable } from '../app/schema.js'
import type { OwltoStore } from '../app/store.js'

/** Automation persistence in `owlto.db`. Rows are local and never synced. */
export class AutomationStore {
  constructor(private readonly store: OwltoStore) {}
  private get db() {
    return this.store.db
  }
  /** Every automation, oldest first, so the list keeps its order as they change. */
  list(): Automation[] {
    return this.db
      .select()
      .from(automationsTable)
      .all()
      .flatMap((row) => {
        // A row an older or newer build wrote in another shape is skipped, not fatal.
        const parsed = automationSchema.safeParse(row.value)
        return parsed.success ? [parsed.data] : []
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  }
  put(automation: Automation): Automation {
    const value = automationSchema.parse(automation)
    const row = { updatedAt: value.updatedAt, value }
    this.db
      .insert(automationsTable)
      .values({ id: value.id, ...row })
      .onConflictDoUpdate({ target: automationsTable.id, set: row })
      .run()
    return value
  }
  remove(id: string): void {
    this.db.delete(automationsTable).where(eq(automationsTable.id, id)).run()
  }
}
