/** A WebSocket that collects text messages in order, so steps can wait for the next one. */
export class Peer {
  readonly socket: WebSocket
  private texts: string[] = []
  private bytes: Uint8Array[] = []
  private waiters: (() => void)[] = []
  closed: { code: number; reason: string } | null = null
  constructor(url: string) {
    this.socket = new WebSocket(url)
    this.socket.binaryType = 'arraybuffer'
    this.socket.addEventListener('message', (event) => {
      if (typeof event.data === 'string') this.texts.push(event.data)
      else this.bytes.push(new Uint8Array(event.data as ArrayBuffer))
      this.wake()
    })
    this.socket.addEventListener('close', (event) => {
      this.closed = { code: event.code, reason: event.reason }
      this.wake()
    })
  }
  private wake() {
    for (const waiter of this.waiters.splice(0)) waiter()
  }
  private async until<T>(take: () => T | undefined): Promise<T> {
    const started = Date.now()
    for (;;) {
      const value = take()
      if (value !== undefined) return value
      if (Date.now() - started > 2000) throw new Error('timed out')
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve)
        setTimeout(resolve, 50)
      })
    }
  }
  opened(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) return Promise.resolve()
    return new Promise((resolve, reject) => {
      this.socket.addEventListener('open', () => resolve(), { once: true })
      this.socket.addEventListener('error', () => reject(new Error('failed')), { once: true })
    })
  }
  async send(message: unknown) {
    await this.opened()
    this.socket.send(typeof message === 'string' ? message : JSON.stringify(message))
  }
  async sendBytes(bytes: Uint8Array) {
    await this.opened()
    this.socket.send(bytes)
  }
  async next(): Promise<Record<string, unknown> | string> {
    const text = await this.until(() => this.texts.shift())
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  nextBytes(): Promise<Uint8Array> {
    return this.until(() => this.bytes.shift())
  }
  closedWith(): Promise<{ code: number; reason: string }> {
    return this.until(() => this.closed ?? undefined)
  }
}
