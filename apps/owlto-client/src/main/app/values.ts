import { z } from 'zod'

/** Small readers for untrusted values from agent CLIs, SDKs, and wire protocols. */
export const recordSchema = z.record(z.string(), z.unknown())
export function record(value: unknown): Record<string, unknown> {
  return recordSchema.parse(value)
}
export function string(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}
/** A message safe to log or show: bearer tokens and API keys are redacted. */
export function safeText(value: unknown): string {
  return string(value)
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b(sk-[a-zA-Z0-9_-]{12,}|eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_.-]+)/g, '[redacted]')
}
