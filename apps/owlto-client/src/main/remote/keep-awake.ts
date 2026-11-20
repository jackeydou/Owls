/**
 * Keeps the Mac awake while remote access is on, the user asked for it, and the Mac runs
 * on power: a sleeping Mac drops every connection and cannot run what a phone sends it.
 * On battery it sleeps as usual. Electron's `powerSaveBlocker` and `powerMonitor` sit
 * behind `KeepAwakePower`, so the policy is testable.
 */
export type KeepAwakePower = {
  onBattery(): boolean
  /** Starts blocking sleep; returns a handle for `stop`. */
  start(): number
  stop(handle: number): void
}

export class KeepAwake {
  private handle: number | null = null
  constructor(
    private readonly power: KeepAwakePower,
    private readonly wanted: () => boolean
  ) {}
  /** Call when the setting, remote access, or the power source changes. */
  update(): void {
    const keep = this.wanted() && !this.power.onBattery()
    if (keep && this.handle === null) this.handle = this.power.start()
    else if (!keep && this.handle !== null) {
      this.power.stop(this.handle)
      this.handle = null
    }
  }
  active(): boolean {
    return this.handle !== null
  }
  close(): void {
    if (this.handle !== null) this.power.stop(this.handle)
    this.handle = null
  }
}
