export type UsageDailyStat = {
  date: string
  tokenCount: number
  messageCount: number
}

export type UsageModelStat = {
  modelId: string
  tokenCount: number
}

export type UsageStats = {
  totalTokens: number
  totalMessages: number
  models: UsageModelStat[]
  daily: UsageDailyStat[]
}
