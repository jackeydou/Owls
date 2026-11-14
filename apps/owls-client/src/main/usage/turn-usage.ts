import { z } from 'zod'
import type { TurnUsage } from '../../shared/usage-stats.js'

const count = z.number().catch(0)
const modelUsageSchema = z.record(
  z.string(),
  z.object({
    inputTokens: count,
    outputTokens: count,
    cacheReadInputTokens: count,
    cacheCreationInputTokens: count,
    thinkingTokens: count.optional(),
    costUSD: z.number().optional().catch(undefined)
  })
)
const resultSchema = z.object({
  // Not in the SDK's types yet, but sent by the CLI: per-model usage since the
  // previous result. `modelUsage` itself is a running total that a resumed
  // session starts from its saved transcript, so it cannot be summed.
  model_usage_since_last_result: modelUsageSchema.optional().catch(undefined),
  usage: z
    .object({
      input_tokens: count,
      output_tokens: count,
      cache_read_input_tokens: count,
      cache_creation_input_tokens: count,
      output_tokens_details: z.object({ thinking_tokens: count }).optional().catch(undefined)
    })
    .catch({
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens_details: undefined
    })
})

/**
 * A Claude Code `result` message's usage, one entry per model, sorted by model.
 * It covers every call of the turn, subagents and compaction included. A CLI
 * that sends no per-result breakdown falls back to the main loop's usage,
 * without model or cost.
 */
export function claudeResultUsage(message: unknown): TurnUsage[] {
  const parsed = resultSchema.safeParse(message)
  if (!parsed.success) return []
  const since = parsed.data.model_usage_since_last_result
  if (since)
    return Object.entries(since)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([model, usage]) => ({
        model,
        input: usage.inputTokens,
        output: usage.outputTokens,
        cacheRead: usage.cacheReadInputTokens,
        cacheWrite: usage.cacheCreationInputTokens,
        reasoning: usage.thinkingTokens ?? 0,
        costUsd: usage.costUSD ?? null
      }))
  const usage = parsed.data.usage
  return [
    {
      model: null,
      input: usage.input_tokens,
      output: usage.output_tokens,
      cacheRead: usage.cache_read_input_tokens,
      cacheWrite: usage.cache_creation_input_tokens,
      reasoning: usage.output_tokens_details?.thinking_tokens ?? 0,
      costUsd: null
    }
  ]
}

/** Codex's per-call usage (`tokenUsage.last`); its input count includes cache reads. */
export function codexCallUsage(last: unknown, model: string | null): TurnUsage {
  const value = z
    .object({
      inputTokens: count,
      cachedInputTokens: count,
      cacheWriteInputTokens: count,
      outputTokens: count,
      reasoningOutputTokens: count
    })
    .catch({
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0
    })
    .parse(last ?? {})
  return {
    model,
    input: Math.max(0, value.inputTokens - value.cachedInputTokens),
    output: value.outputTokens,
    cacheRead: value.cachedInputTokens,
    cacheWrite: value.cacheWriteInputTokens,
    reasoning: value.reasoningOutputTokens,
    costUsd: null
  }
}
