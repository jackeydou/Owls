import { useEffect, useState } from 'react'
import { providerSchema } from '../../../shared/app'
import { agentConnection, isAgentReady, isAgentStarting, useAppStore } from '../app/store'
import { useOnboardingStore } from './store'

/**
 * False until the agents that connect as the app starts have finished, so a working setup
 * never flashes onboarding. Later connections are the user's own and do not reset it.
 */
export function useStartupSettled(): boolean {
  const connecting = useAppStore((s) => providerSchema.options.some((p) => isAgentStarting(s, p)))
  const [settled, setSettled] = useState(!connecting)
  useEffect(() => {
    if (!connecting) setSettled(true)
  }, [connecting])
  return settled
}

/** True once the user has set up anything onboarding asks for: an agent, or the Router. */
export function useAnythingConfigured(): boolean {
  return useAppStore((s) => {
    if (providerSchema.options.some((p) => isAgentReady(agentConnection(s, p)))) return true
    const { router } = s.settings
    return router.engine !== 'owlto' || router.owlto !== null
  })
}

/**
 * Opens onboarding on first run, and retires it for good once anything is configured: a
 * user who already has a setup never sees it, and a user who skipped it stops seeing the
 * setup card. Mounted once, with the app.
 */
export function OnboardingHost() {
  const settled = useStartupSettled()
  const configured = useAnythingConfigured()
  const state = useAppStore((s) => s.settings.onboarding)
  const save = useAppStore((s) => s.saveSettings)
  const open = useOnboardingStore((s) => s.open)
  const show = useOnboardingStore((s) => s.show)
  // Opened once per launch: skipping, then reopening from the card, is the user's call.
  const [checked, setChecked] = useState(false)
  useEffect(() => {
    if (!settled || checked) return
    setChecked(true)
    if (state === 'pending' && !configured) show()
  }, [settled, checked, state, configured, show])
  useEffect(() => {
    // While onboarding is open, its own Finish or Skip decides.
    if (!settled || open || state === 'done' || !configured) return
    const { settings } = useAppStore.getState()
    void save({ ...settings, onboarding: 'done' })
  }, [settled, open, state, configured, save])
  return null
}
