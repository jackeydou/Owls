import { useEffect, useState } from 'react'
import type { FeatureFlagKey, FeatureFlagValue } from '../../../shared/analytics'

/**
 * A PostHog feature flag for an A/B test: `undefined` while it loads, then its variant,
 * true or false, or null. Null (no analytics in this build, usage data off, unknown flag,
 * or PostHog unreachable) should render the control experience.
 */
export function useFeatureFlag(key: FeatureFlagKey): FeatureFlagValue | undefined {
  const [value, setValue] = useState<FeatureFlagValue | undefined>(
    __OWLTO_ANALYTICS__ ? undefined : null
  )
  useEffect(() => {
    if (!__OWLTO_ANALYTICS__) return
    let live = true
    setValue(undefined)
    void window.owlto.featureFlag(key).then((reply) => {
      if (live) setValue(reply.ok ? reply.value : null)
    })
    return () => {
      live = false
    }
  }, [key])
  return value
}
