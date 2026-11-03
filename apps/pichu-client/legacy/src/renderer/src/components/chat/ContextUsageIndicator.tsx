import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useI18n } from '@renderer/lib/i18n'
import { useCallback, useEffect, useState } from 'react'
import type { AgentContextUsage, AgentEventPayload } from '../../../../preload/index.d'
import { useSessionStore } from '../../stores/session-store'

type ContextSummary = {
  usedPercent: number
  percentLabel: string
  usedTokensLabel: string
  totalTokensLabel: string
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

function formatTokenCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value < 1_000) return String(Math.round(value))
  if (value < 1_000_000) return `${Math.round(value / 1_000)}k`

  const millions = value / 1_000_000
  const rounded = millions >= 10 ? Math.round(millions).toString() : millions.toFixed(1)
  return `${rounded.replace(/\.0$/, '')}m`
}

function buildContextSummary(usage: AgentContextUsage | null): ContextSummary | null {
  if (!usage) return null
  if (!Number.isFinite(usage.contextWindow) || usage.contextWindow <= 0) return null

  const usedPercent = clampPercent((usage.totalTokens / usage.contextWindow) * 100)
  return {
    usedPercent,
    percentLabel: `${Math.round(usedPercent)}%`,
    usedTokensLabel: formatTokenCount(usage.totalTokens),
    totalTokensLabel: formatTokenCount(usage.contextWindow)
  }
}

function isUsageRefreshEvent(payload: AgentEventPayload): boolean {
  const event = payload.event
  if (event.type === 'message_end' || event.type === 'turn_end' || event.type === 'agent_end') {
    return true
  }
  if (event.type !== 'message_update') return false
  if (!('assistantMessageEvent' in event)) return false
  return event.assistantMessageEvent?.type === 'toolcall_end'
}

export function ContextUsageIndicator(): React.JSX.Element | null {
  const { t } = useI18n()
  const sessionId = useSessionStore((state) => state.sessionId)
  const activeSessionModel = useSessionStore((state) => state.activeSessionModel)
  const [usage, setUsage] = useState<AgentContextUsage | null>(null)

  const refreshUsage = useCallback((): void => {
    if (!sessionId) {
      setUsage(null)
      return
    }

    const requestSessionId = sessionId
    void window.api.agent
      .contextUsage(requestSessionId)
      .then((nextUsage) => {
        if (useSessionStore.getState().sessionId !== requestSessionId) return
        setUsage(nextUsage)
      })
      .catch(console.error)
  }, [sessionId])

  useEffect(() => {
    refreshUsage()
    const unsubscribeEvent = window.api.agent.onEvent((payload) => {
      if (payload.sessionId !== sessionId) return
      if (isUsageRefreshEvent(payload)) {
        refreshUsage()
      }
    })
    const unsubscribeRunState = window.api.agent.onRunState((payload) => {
      if (payload.sessionId !== sessionId) return
      if (!payload.running || payload.completedRun) {
        refreshUsage()
      }
    })
    return () => {
      unsubscribeEvent()
      unsubscribeRunState()
    }
  }, [refreshUsage, sessionId])

  if (!sessionId) return null

  const summary = buildContextSummary(usage)
  const effectiveModelId = usage?.modelId?.trim()
  const sessionModelId = activeSessionModel?.modelId?.trim()
  const showEffectiveModel = Boolean(
    effectiveModelId && sessionModelId && effectiveModelId !== sessionModelId
  )

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="grid size-[var(--pichu-composer-button-size)] place-items-center rounded-full text-muted-foreground transition-colors hover:bg-codex-light-button-secondary hover:text-muted-foreground focus-visible:bg-codex-light-button-secondary dark:hover:bg-codex-dark-button-secondary-hover dark:hover:text-muted-foreground dark:focus-visible:bg-codex-dark-button-secondary-hover"
          onMouseEnter={refreshUsage}
          onFocus={refreshUsage}
          aria-label={t('model.context.label')}
        >
          <span
            className="grid size-3.5 place-items-center rounded-full"
            style={{
              background: summary
                ? `conic-gradient(currentColor ${summary.usedPercent * 3.6}deg, rgb(0 0 0 / 0.14) 0deg)`
                : 'rgb(0 0 0 / 0.14)'
            }}
            aria-hidden
          >
            <span className="size-2.5 rounded-full bg-background dark:bg-card" aria-hidden />
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6} className="w-fit px-2.5 text-center">
        <div className="text-muted-foreground">{t('model.context.label')}:</div>
        {summary ? (
          <>
            <div className="mt-1 text-muted-foreground">
              {t('model.context.full', { percent: summary.percentLabel })}
            </div>
            <div className="mt-1 text-foreground">
              {t('model.context.tokens', {
                used: summary.usedTokensLabel,
                total: summary.totalTokensLabel
              })}
            </div>
            {showEffectiveModel ? (
              <div className="mt-1 text-muted-foreground">
                {t('model.context.effectiveModel', { model: effectiveModelId ?? '' })}
              </div>
            ) : null}
          </>
        ) : (
          <div className="mt-1 text-muted-foreground">{t('model.context.awaitingUsage')}</div>
        )}
      </TooltipContent>
    </Tooltip>
  )
}
