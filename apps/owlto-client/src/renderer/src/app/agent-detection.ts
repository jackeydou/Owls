import { useEffect } from 'react'
import { create } from 'zustand'
import type { AgentDetection, AgentProvider } from '../../../shared/app'
import { agentConnection, useAppStore } from './store'

/** Which agent CLIs are on this Mac. Null until the first look, or when it failed. */
export const useAgentDetectionStore = create<{
  detection: AgentDetection | null
  detect(): Promise<void>
}>((set) => ({
  detection: null,
  detect: async () => {
    const reply = await window.owlto.detectAgents()
    if (reply.ok) set({ detection: reply.value })
  }
}))

export type AgentPresence = 'unknown' | 'found' | 'missing'

/**
 * Looks for the agents' CLIs when the caller mounts, and again whenever an executable
 * path changes, without connecting any of them.
 */
export function useDetectAgents(): void {
  const detect = useAgentDetectionStore((s) => s.detect)
  const paths = useAppStore(
    (s) =>
      `${s.settings.executablePath}|${s.settings.claudeExecutablePath}|${s.settings.cursorExecutablePath}`
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: `paths` is the trigger, not an input.
  useEffect(() => {
    void detect()
  }, [detect, paths])
}

/** Whether an agent's CLI is on this Mac. A live connection proves it is. */
export function useAgentPresence(provider: AgentProvider): AgentPresence {
  const connected = useAppStore((s) => Boolean(agentConnection(s, provider).executablePath))
  const found = useAgentDetectionStore((s) =>
    s.detection ? s.detection[provider].path !== null : null
  )
  if (connected || found) return 'found'
  return found === false ? 'missing' : 'unknown'
}

/** The CLI path detection found, for the Location row. */
export function useDetectedPath(provider: AgentProvider): string | null {
  return useAgentDetectionStore((s) => s.detection?.[provider].path ?? null)
}
