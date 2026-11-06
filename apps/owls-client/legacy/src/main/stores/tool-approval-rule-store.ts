import crypto from 'node:crypto'
import { eq } from 'drizzle-orm'
import type {
  ToolApprovalRememberRuleProposal,
  ToolApprovalRequestForRenderer
} from '../../shared/tool-approval.js'
import { db } from '../db/index.js'
import { toolApprovalRules } from '../db/schema.js'
import {
  buildToolApprovalRememberRuleProposal,
  commandMatchesRememberRule
} from '../tool-approval-rules.js'

type ToolApprovalRuleRow = typeof toolApprovalRules.$inferSelect

function parseRuleJson(value: string): ToolApprovalRememberRuleProposal | null {
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    if ((parsed as { type?: unknown }).type !== 'commandPrefix') return null
    const commandPrefix = (parsed as { commandPrefix?: unknown }).commandPrefix
    const display = (parsed as { display?: unknown }).display
    if (
      !Array.isArray(commandPrefix) ||
      commandPrefix.length === 0 ||
      !commandPrefix.every((token) => typeof token === 'string' && token.trim())
    ) {
      return null
    }
    if (typeof display !== 'string' || !display.trim()) return null
    return {
      type: 'commandPrefix',
      commandPrefix,
      display
    }
  } catch {
    return null
  }
}

function rowRule(row: ToolApprovalRuleRow): ToolApprovalRememberRuleProposal | null {
  if (row.kind !== 'command_prefix' || row.status !== 'active') return null
  return parseRuleJson(row.ruleJson)
}

export function findMatchingToolApprovalRule(
  request: ToolApprovalRequestForRenderer
): ToolApprovalRememberRuleProposal | null {
  const rows = db()
    .select()
    .from(toolApprovalRules)
    .where(eq(toolApprovalRules.status, 'active'))
    .all()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  for (const row of rows) {
    const rule = rowRule(row)
    if (!rule || !commandMatchesRememberRule(request, rule)) continue
    db()
      .update(toolApprovalRules)
      .set({ lastMatchedAt: new Date().toISOString() })
      .where(eq(toolApprovalRules.id, row.id))
      .run()
    return rule
  }

  return null
}

export function rememberToolApprovalRuleForRequest(
  request: ToolApprovalRequestForRenderer
): ToolApprovalRememberRuleProposal | null {
  const rule = buildToolApprovalRememberRuleProposal(request)
  if (!rule) return null

  const ruleJson = JSON.stringify(rule)
  const existing = db()
    .select()
    .from(toolApprovalRules)
    .where(eq(toolApprovalRules.ruleJson, ruleJson))
    .get()
  const now = new Date().toISOString()

  if (existing) {
    db()
      .update(toolApprovalRules)
      .set({
        status: 'active',
        sourceApprovalId: request.id,
        updatedAt: now
      })
      .where(eq(toolApprovalRules.id, existing.id))
      .run()
    return rule
  }

  db()
    .insert(toolApprovalRules)
    .values({
      id: crypto.randomUUID(),
      kind: 'command_prefix',
      status: 'active',
      scope: 'global',
      ruleJson,
      display: rule.display,
      sourceApprovalId: request.id,
      createdAt: now,
      updatedAt: now,
      lastMatchedAt: null
    })
    .run()
  return rule
}
