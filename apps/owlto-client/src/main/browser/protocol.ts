/** Messages between the main process and the browser host utility process. */
export type BrowserHostRequest = {
  type: 'run'
  id: string
  /** One worker's page: the same key keeps the same tab between runs. */
  key: string
  code: string
  timeoutMs: number
  /** The Chrome profile Owlto's browser keeps, so sign-ins survive restarts. */
  profileDir: string
  /** Where a script's returned screenshot bytes are saved. */
  shotsDir: string
}

export type BrowserHostReply = { type: 'result'; id: string; ok: boolean; text: string }
