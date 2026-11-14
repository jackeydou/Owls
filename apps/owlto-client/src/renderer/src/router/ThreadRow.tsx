import type { ReactNode } from 'react'
import { OwlAvatar } from '../app/OwlAvatar'
import { UserAvatar } from '../app/UserAvatar'

export type ThreadSpeaker = 'router' | 'user'

/** One line of the thread. `follows` hides the avatar under the same speaker's last row. */
export function ThreadRow({
  speaker,
  follows = false,
  entryId,
  children
}: {
  speaker: ThreadSpeaker
  follows?: boolean
  /** Lets the timeline find a row, e.g. to bring a just-sent message to the top. */
  entryId?: string
  children: ReactNode
}) {
  return (
    <div className={`router-row ${speaker}${follows ? ' follows' : ''}`} data-entry-id={entryId}>
      <div className="router-row-avatar" aria-hidden="true">
        {follows ? null : speaker === 'router' ? <OwlAvatar speaker="router" /> : <UserAvatar />}
      </div>
      <div className="router-row-body">{children}</div>
    </div>
  )
}
