import { z } from 'zod'
import { deviceIdSchema } from '../../shared/app.js'
import { remoteCallSchema, remotePairSchema } from '../../shared/remote.js'
import type { IpcHandle } from '../app/ipc.js'
import type { RemoteService } from './service.js'

/** The `remote-*` channels behind `window.owlto.remote`. */
export function registerRemoteIpc(handle: IpcHandle, remote: RemoteService): void {
  handle('remote-overview', () => remote.overview())
  handle('remote-set-access', (input) => remote.setAccess(z.boolean().parse(input)))
  handle('remote-start-pairing', () => remote.startPairing())
  handle('remote-cancel-pairing', () => remote.cancelPairing())
  handle('remote-revoke-client', (input) => remote.revokeClient(deviceIdSchema.parse(input)))
  handle('remote-pair', (input) => {
    const { address, code } = remotePairSchema.parse(input)
    return remote.pair(address, code)
  })
  handle('remote-remove-device', (input) => remote.removeDevice(deviceIdSchema.parse(input)))
  handle('remote-call', (input) => {
    const { deviceId, method, params } = remoteCallSchema.parse(input)
    return remote.call(deviceId, method, params)
  })
}
