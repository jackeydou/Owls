import { MessageChannelMain, type WebContents } from 'electron'
import type { AppSettings } from '../../shared/app.js'
import { simulatorAnswerSchema, simulatorUdidSchema } from '../../shared/simulator.js'
import type { IpcHandle } from '../app/ipc.js'
import type { SimulatorHostClient } from './host-client.js'
import type { SimulatorService } from './service.js'

/** The `simulator-*` channels behind `window.owlto.simulator`. */
export function registerSimulatorIpc(
  handle: IpcHandle,
  simulator: SimulatorService,
  host: SimulatorHostClient,
  deps: {
    contents: () => WebContents | null
    settings: () => AppSettings
    save: (settings: AppSettings) => AppSettings
  }
): void {
  handle('simulator-snapshot', () => simulator.snapshot())
  handle('simulator-refresh', () => simulator.refresh())
  handle('simulator-attach', (input) => simulator.attach(simulatorUdidSchema.parse(input)))
  handle('simulator-detach', (input) => simulator.detach(simulatorUdidSchema.parse(input)))
  handle('simulator-shutdown', (input) => simulator.shutdown(simulatorUdidSchema.parse(input)))
  handle('simulator-answer', (input) => {
    const { askId, answer } = simulatorAnswerSchema.parse(input)
    const ask = simulator.pendingAsk(askId)
    if (!ask) return null
    let saved: AppSettings | null = null
    // Consent is saved before the ask settles, so the worker's call already sees it.
    if (answer === 'allow' && ask.kind === 'device') {
      const settings = deps.settings()
      const allowed = new Set([...settings.simulator.allowedDevices, ask.udid])
      saved = deps.save({
        ...settings,
        simulator: { ...settings.simulator, allowedDevices: [...allowed].sort() }
      })
    }
    simulator.answer(askId, answer === 'allow')
    return saved
  })
  handle('simulator-open-stream', async (input) => {
    const udid = simulatorUdidSchema.parse(input)
    const target = deps.contents()
    if (!target) throw new Error('Owlto has no window.')
    if (!simulator.isAttached(udid)) throw new Error('Attach the simulator first.')
    // The host and the panel talk over this channel directly, so video skips the main process.
    const { port1, port2 } = new MessageChannelMain()
    await host.call({ type: 'stream', udid }, [port1])
    target.postMessage('owlto:simulator-stream', udid, [port2])
  })
}
