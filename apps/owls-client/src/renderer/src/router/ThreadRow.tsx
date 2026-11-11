import { UserIcon } from '@renderer/components/ui/icons'
import type { ReactNode } from 'react'
import { AppLogoMark } from '../app/AppLogo'

export type ThreadSpeaker = 'router' | 'user'

/** One line of the thread. `follows` hides the avatar under the same speaker's last row. */
export function ThreadRow({
  speaker,
  follows = false,
  children
}: {
  speaker: ThreadSpeaker
  follows?: boolean
  children: ReactNode
}) {
  return (
    <div className={`router-row ${speaker}${follows ? ' follows' : ''}`}>
      <div className="router-row-avatar" aria-hidden="true">
        {follows ? null : speaker === 'router' ? <AppLogoMark /> : <UserIcon size={14} />}
      </div>
      <div className="router-row-body">{children}</div>
    </div>
  )
}
