import type { UsageStats } from '../../shared/usage-stats.js'
import { db } from '../db/index.js'
import { usageDailyStats, usageModelStats } from '../db/schema.js'

export function getUsageStats(): UsageStats {
  const daily = db().select().from(usageDailyStats).orderBy(usageDailyStats.date).all()
  const models = db().select().from(usageModelStats).orderBy(usageModelStats.modelId).all()

  return {
    totalTokens: daily.reduce((total, day) => total + day.tokenCount, 0),
    totalMessages: daily.reduce((total, day) => total + day.messageCount, 0),
    models: models.sort(
      (a, b) => b.tokenCount - a.tokenCount || a.modelId.localeCompare(b.modelId)
    ),
    daily
  }
}
