import claudeCode from '../../../../resources/owl-avatars/claude-code.svg'
import codex from '../../../../resources/owl-avatars/codex.svg'
import router from '../../../../resources/owl-avatars/router.svg'
import type { AgentProvider } from '../../../shared/app'

/** Who is speaking: the Router itself, or the provider running a worker. */
export type AgentSpeaker = AgentProvider | 'router'

const OWLS: Record<AgentSpeaker, string> = { 'claude-code': claudeCode, codex, router }

/** Decorative: the speaker's name, where it matters, is next to it. */
export function OwlAvatar({ speaker }: { speaker: AgentSpeaker }) {
  return <img className="owls-owl-avatar" src={OWLS[speaker]} data-speaker={speaker} alt="" />
}
