import { randomUUID } from 'node:crypto'
import { type MessagePortMain, type UtilityProcess, utilityProcess } from 'electron'
import type { SimulatorHostPaths, SimulatorHostReply, SimulatorHostRequest } from './protocol.js'

/** Distributive Omit, so each request keeps its own fields. */
type RequestBody = SimulatorHostRequest extends infer R
  ? R extends SimulatorHostRequest
    ? Omit<R, 'id'>
    : never
  : never

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

/** How long one host call may take; attaching a device that is still booting is the slowest. */
const CALL_TIMEOUT_MS = 60_000

/**
 * Starts the simulator host utility process on first use and forwards calls to it. When the
 * host exits, every call in flight fails, `onExit` tells the service to forget its captures,
 * and the next call starts a new host.
 */
export class SimulatorHostClient {
  private child: UtilityProcess | null = null
  private readonly pending = new Map<string, Pending>()

  constructor(
    private readonly entry: string,
    private readonly paths: SimulatorHostPaths,
    private readonly onExit: () => void
  ) {}

  call(body: RequestBody, ports: MessagePortMain[] = []): Promise<unknown> {
    const child = this.start()
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('The simulator host did not answer in time.'))
      }, CALL_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      child.postMessage({ ...body, id } as SimulatorHostRequest, ports)
    })
  }

  close(): void {
    const child = this.child
    this.child = null
    child?.kill()
    this.settleAll('Owlto is quitting.')
  }

  private start(): UtilityProcess {
    if (this.child) return this.child
    const child = utilityProcess.fork(this.entry, [JSON.stringify(this.paths)], {
      serviceName: 'Owlto Simulator',
      stdio: 'ignore'
    })
    child.on('message', (reply: SimulatorHostReply) => {
      const entry = this.pending.get(reply.id)
      if (!entry) return
      this.pending.delete(reply.id)
      clearTimeout(entry.timer)
      if (reply.ok) entry.resolve(reply.value)
      else entry.reject(new Error(reply.error))
    })
    child.on('exit', () => {
      if (this.child !== child) return
      this.child = null
      this.settleAll('The simulator host stopped. Attach the simulator again.')
      this.onExit()
    })
    this.child = child
    return child
  }

  private settleAll(reason: string): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(new Error(reason))
    }
    this.pending.clear()
  }
}
