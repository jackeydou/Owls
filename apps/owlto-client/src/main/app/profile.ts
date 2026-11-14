import type { AppSettings } from '../../shared/app.js'
import { type Profile, profileSchema, profileUpdateSchema } from '../../shared/profile.js'
import { OwltoError } from './errors.js'

export type UserProfileDeps = {
  settings: () => AppSettings
  save: (settings: AppSettings) => AppSettings
  /** A token for the GitHub connection; null when the user is not connected. */
  gitHubToken: () => Promise<string | null>
  fetchAvatar: (token: string) => Promise<{ login: string; src: string }>
  /** Tells the window about a change it did not ask for. */
  changed: (profile: Profile) => void
}

/**
 * The user's name and avatar. The settings page changes them through `update`; a GitHub
 * connection swaps the default owl for the GitHub avatar once, unless the user already
 * changed the avatar themselves.
 */
export class UserProfile {
  private adopting: Promise<void> | null = null

  constructor(private readonly deps: UserProfileDeps) {}

  update(input: unknown): AppSettings {
    const update = profileUpdateSchema.parse(input)
    const profile = this.deps.settings().profile
    return this.save({
      name: update.name === undefined ? profile.name : update.name,
      avatar: update.avatar ?? profile.avatar,
      avatarChanged: profile.avatarChanged || update.avatar !== undefined
    })
  }

  /** The user asked for their GitHub avatar, so it counts as their own choice. */
  async applyGitHubAvatar(): Promise<AppSettings> {
    const avatar = await this.gitHubAvatar()
    if (!avatar) throw new OwltoError('avatar_unavailable', 'Could not get the GitHub avatar.')
    return this.save({
      ...this.deps.settings().profile,
      avatar: { kind: 'github', ...avatar },
      avatarChanged: true
    })
  }

  /**
   * Called whenever GitHub reports a signed-in account. Best effort: a failed request
   * leaves the owl, and the next report tries again.
   */
  gitHubConnected(): Promise<void> {
    if (!this.untouched()) return Promise.resolve()
    this.adopting ??= this.adopt().finally(() => {
      this.adopting = null
    })
    return this.adopting
  }

  private async adopt(): Promise<void> {
    const avatar = await this.gitHubAvatar()
    // The user may have picked an avatar while the request ran.
    if (!avatar || !this.untouched()) return
    const saved = this.save({
      ...this.deps.settings().profile,
      avatar: { kind: 'github', ...avatar }
    })
    this.deps.changed(saved.profile)
  }

  private untouched(): boolean {
    const { avatar, avatarChanged } = this.deps.settings().profile
    return avatar.kind === 'owl' && !avatarChanged
  }

  private async gitHubAvatar(): Promise<{ login: string; src: string } | null> {
    try {
      const token = await this.deps.gitHubToken()
      return token ? await this.deps.fetchAvatar(token) : null
    } catch {
      return null
    }
  }

  private save(profile: Profile): AppSettings {
    return this.deps.save({ ...this.deps.settings(), profile: profileSchema.parse(profile) })
  }
}
