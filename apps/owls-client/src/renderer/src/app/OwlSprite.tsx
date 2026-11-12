import type { CSSProperties } from 'react'
import claudeCodeFlying from '../../../../resources/owl-avatars/sprites/claude-code-flying.png'
import claudeCodeIdle from '../../../../resources/owl-avatars/sprites/claude-code-idle.png'
import claudeCodeThinking from '../../../../resources/owl-avatars/sprites/claude-code-thinking.png'
import claudeCodeTyping from '../../../../resources/owl-avatars/sprites/claude-code-typing.png'
import claudeCodeWave from '../../../../resources/owl-avatars/sprites/claude-code-wave.png'
import codexFlying from '../../../../resources/owl-avatars/sprites/codex-flying.png'
import codexIdle from '../../../../resources/owl-avatars/sprites/codex-idle.png'
import codexThinking from '../../../../resources/owl-avatars/sprites/codex-thinking.png'
import codexTyping from '../../../../resources/owl-avatars/sprites/codex-typing.png'
import codexWave from '../../../../resources/owl-avatars/sprites/codex-wave.png'
import routerFlying from '../../../../resources/owl-avatars/sprites/router-flying.png'
import routerIdle from '../../../../resources/owl-avatars/sprites/router-idle.png'
import routerThinking from '../../../../resources/owl-avatars/sprites/router-thinking.png'
import routerTyping from '../../../../resources/owl-avatars/sprites/router-typing.png'
import routerWave from '../../../../resources/owl-avatars/sprites/router-wave.png'
import type { AgentSpeaker } from './OwlAvatar'

export type OwlAction = 'idle' | 'typing' | 'wave' | 'thinking' | 'flying'

/** Each sheet is one row of 32x32 frames; every frame lasts FRAME_MS. */
const FRAME_MS = 120
const FRAMES: Record<OwlAction, number> = { idle: 24, typing: 24, wave: 4, thinking: 12, flying: 6 }
const SHEETS: Record<AgentSpeaker, Record<OwlAction, string>> = {
  'claude-code': {
    idle: claudeCodeIdle,
    typing: claudeCodeTyping,
    wave: claudeCodeWave,
    thinking: claudeCodeThinking,
    flying: claudeCodeFlying
  },
  codex: {
    idle: codexIdle,
    typing: codexTyping,
    wave: codexWave,
    thinking: codexThinking,
    flying: codexFlying
  },
  router: {
    idle: routerIdle,
    typing: routerTyping,
    wave: routerWave,
    thinking: routerThinking,
    flying: routerFlying
  }
}

/** A looping full-body owl. Decorative: say what it means in text next to it. */
export function OwlSprite({
  speaker,
  action,
  size = 32
}: {
  speaker: AgentSpeaker
  action: OwlAction
  /** Rendered edge in CSS pixels. Multiples of 32 keep the pixels square. */
  size?: number
}) {
  const frames = FRAMES[action]
  const style: CSSProperties & Record<'--owl-shift', string> = {
    width: size,
    height: size,
    backgroundImage: `url(${SHEETS[speaker][action]})`,
    backgroundSize: `${frames * size}px ${size}px`,
    animationDuration: `${frames * FRAME_MS}ms`,
    animationTimingFunction: `steps(${frames})`,
    '--owl-shift': `${-frames * size}px`
  }
  return (
    <span
      className="owls-owl-sprite"
      data-speaker={speaker}
      data-action={action}
      style={style}
      aria-hidden="true"
    />
  )
}
