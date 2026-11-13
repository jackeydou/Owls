import claudeCode from '../../../../resources/owl-avatars/claude-code.svg'
import codex from '../../../../resources/owl-avatars/codex.svg'
import cursor from '../../../../resources/owl-avatars/cursor.svg'
import router from '../../../../resources/owl-avatars/router.svg'
import claudeCodeWorking from '../../../../resources/owl-avatars/working/claude-code.svg'
import codexWorking from '../../../../resources/owl-avatars/working/codex.svg'
import cursorWorking from '../../../../resources/owl-avatars/working/cursor.svg'
import routerWorking from '../../../../resources/owl-avatars/working/router.svg'
import type { AgentProvider } from '../../../shared/app'

/** Who is speaking: the Router itself, or the provider running a worker. */
export type AgentSpeaker = AgentProvider | 'router'

const OWLS: Record<AgentSpeaker, string> = { 'claude-code': claudeCode, codex, cursor, router }
/** The same owls typing on a laptop. The motion lives in the SVG and stops for reduced motion. */
const WORKING_OWLS: Record<AgentSpeaker, string> = {
  'claude-code': claudeCodeWorking,
  codex: codexWorking,
  cursor: cursorWorking,
  router: routerWorking
}

/** Decorative: the speaker's name, where it matters, is next to it. */
export function OwlAvatar({
  speaker,
  working = false
}: {
  speaker: AgentSpeaker
  working?: boolean
}) {
  return (
    <img
      className="owls-owl-avatar"
      src={(working ? WORKING_OWLS : OWLS)[speaker]}
      data-speaker={speaker}
      data-working={working || undefined}
      alt=""
    />
  )
}
