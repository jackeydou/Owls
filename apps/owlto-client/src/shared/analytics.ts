import { z } from 'zod'

/** A PostHog feature flag key, as created in the PostHog project. */
export const featureFlagKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, 'Feature flag keys are letters, digits, - and _.')
export type FeatureFlagKey = z.infer<typeof featureFlagKeySchema>
/**
 * A flag's value for this install: its variant for a multivariate flag (an A/B test),
 * true or false for a boolean one, and null when the flag is unknown, the build has no
 * analytics, or the user turned usage data off. Callers treat null as the control group.
 */
export type FeatureFlagValue = string | boolean | null
