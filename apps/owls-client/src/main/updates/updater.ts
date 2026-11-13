import { app, autoUpdater, net } from 'electron'
import {
  isNewerRelease,
  releaseChannel,
  type UpdateChannel,
  type UpdateFailure,
  type UpdateSnapshot,
  type UpdateState,
  updateFeedEntrySchema,
  updateFeedUrl
} from '../../shared/updates.js'

const FIRST_CHECK_DELAY_MS = 30_000
const CHECK_INTERVAL_MS = 2 * 60 * 60 * 1000
const FEED_TIMEOUT_MS = 30_000

export type AppUpdaterDeps = {
  /** The saved channel; null follows the installed build. */
  savedChannel: () => UpdateChannel | null
  changed: (snapshot: UpdateSnapshot) => void
  /** Asks about running tasks before quitting; false keeps the app open. */
  approveQuit: () => Promise<boolean>
}

/**
 * macOS updates through Electron's `autoUpdater` (Squirrel.Mac). Owls reads the channel's feed
 * itself and orders versions with `isNewerRelease`, then hands the same feed URL to Squirrel in
 * its default server mode, which downloads the binary delta when the feed offers one for the
 * running build and the full ZIP otherwise, verifies the signature, and installs on quit.
 */
export class AppUpdater {
  private state: UpdateState
  private timers: NodeJS.Timeout[] = []
  /** Bumped by a channel change, so a feed read for the old channel is dropped. */
  private generation = 0

  constructor(private readonly deps: AppUpdaterDeps) {
    this.state = !app.isPackaged
      ? { status: 'unsupported', reason: 'development' }
      : process.platform !== 'darwin'
        ? { status: 'unsupported', reason: 'platform' }
        : { status: 'idle' }
  }

  start(): void {
    if (this.state.status === 'unsupported') return
    autoUpdater.on('update-downloaded', this.downloaded)
    autoUpdater.on('update-not-available', this.notAvailable)
    autoUpdater.on('error', this.errored)
    this.timers.push(
      setTimeout(() => void this.check(), FIRST_CHECK_DELAY_MS),
      setInterval(() => void this.check(), CHECK_INTERVAL_MS)
    )
  }

  snapshot(): UpdateSnapshot {
    const saved = this.deps.savedChannel()
    return {
      currentVersion: app.getVersion(),
      channel: saved ?? releaseChannel(app.getVersion()),
      state: this.state
    }
  }

  async check(): Promise<UpdateSnapshot> {
    // Squirrel downloads again on every check, so one download runs at a time, and a staged
    // update waits for the quit that installs it.
    if (
      this.state.status !== 'idle' &&
      this.state.status !== 'up-to-date' &&
      this.state.status !== 'failed'
    ) {
      return this.snapshot()
    }
    this.set({ status: 'checking' })
    const generation = this.generation
    const url = updateFeedUrl(this.snapshot().channel, process.arch)
    const result = await this.readFeed(url)
    if (generation !== this.generation) return this.snapshot()
    if (result === 'missing') return this.set(this.checked('up-to-date'))
    if (result === 'unreachable') return this.set(this.failed('network'))
    const entry = updateFeedEntrySchema.safeParse(result.body)
    if (!entry.success) return this.set(this.failed('feed'))
    if (!isNewerRelease(entry.data.version, app.getVersion())) {
      return this.set(this.checked('up-to-date'))
    }
    this.set({ status: 'downloading', version: entry.data.version })
    try {
      autoUpdater.setFeedURL({
        url,
        serverType: 'default',
        headers: { 'Cache-Control': 'no-cache' }
      })
      autoUpdater.checkForUpdates()
    } catch {
      return this.set(this.failed('download'))
    }
    return this.snapshot()
  }

  private async readFeed(url: string): Promise<'missing' | 'unreachable' | { body: unknown }> {
    try {
      const response = await net.fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(FEED_TIMEOUT_MS)
      })
      // No feed yet for this channel and architecture.
      if (response.status === 404) return 'missing'
      if (!response.ok) return 'unreachable'
      return { body: await response.json().catch(() => null) }
    } catch {
      return 'unreachable'
    }
  }

  /** A channel change restarts the check unless an update is already on its way. */
  channelChanged(): void {
    const { status } = this.state
    if (status === 'unsupported' || status === 'downloading' || status === 'ready') {
      this.deps.changed(this.snapshot())
      return
    }
    this.generation++
    this.state = { status: 'idle' }
    void this.check()
  }

  async install(): Promise<void> {
    if (this.state.status !== 'ready') return
    if (!(await this.deps.approveQuit())) return
    autoUpdater.quitAndInstall()
  }

  dispose(): void {
    for (const timer of this.timers) clearTimeout(timer)
    this.timers = []
    autoUpdater.removeListener('update-downloaded', this.downloaded)
    autoUpdater.removeListener('update-not-available', this.notAvailable)
    autoUpdater.removeListener('error', this.errored)
  }

  private readonly downloaded = () => {
    if (this.state.status === 'downloading')
      this.set({ status: 'ready', version: this.state.version })
  }

  /** The feed changed between Owls' read and Squirrel's, for example a release was pulled. */
  private readonly notAvailable = () => {
    if (this.state.status === 'downloading') this.set(this.checked('up-to-date'))
  }

  private readonly errored = () => {
    if (this.state.status === 'downloading') this.set(this.failed('download'))
  }

  private checked(status: 'up-to-date'): UpdateState {
    return { status, checkedAt: new Date().toISOString() }
  }

  private failed(failure: UpdateFailure): UpdateState {
    return { status: 'failed', failure, checkedAt: new Date().toISOString() }
  }

  private set(state: UpdateState): UpdateSnapshot {
    this.state = state
    const snapshot = this.snapshot()
    this.deps.changed(snapshot)
    return snapshot
  }
}
