import type { AgentSpeaker } from './OwlAvatar'

/**
 * Three dots bouncing in a pill, stepping through the speaker's colors. Sits next to the
 * speaker's working owl so a quiet stretch of a turn never reads as done.
 */
export function WorkingDots({ speaker }: { speaker: AgentSpeaker }) {
  return (
    <span className="owlto-working-dots" data-speaker={speaker} aria-hidden>
      <i />
      <i />
      <i />
    </span>
  )
}
