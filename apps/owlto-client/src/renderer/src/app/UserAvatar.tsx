import userOwl from '../../../../resources/owl-avatars/user.svg'
import { useAppStore } from './store'

/** The user's owl, used until they upload a picture or connect GitHub. */
export const defaultUserAvatar = userOwl

/** Decorative: the user's name, where it matters, is next to it. */
export function UserAvatar({ className }: { className?: string }) {
  const avatar = useAppStore((s) => s.settings.profile.avatar)
  return (
    <img
      className={`owlto-user-avatar${className ? ` ${className}` : ''}`}
      src={avatar.kind === 'owl' ? userOwl : avatar.src}
      data-avatar={avatar.kind}
      alt=""
    />
  )
}
