import { z } from 'zod'
import { deviceIdSchema } from '../../shared/app.js'
import {
  relayMailboxSchema,
  remoteCallSchema,
  remoteRelayProviderSchema
} from '../../shared/remote.js'
import type { IpcHandle } from '../app/ipc.js'
import type { RemoteService } from './service.js'

/** The `remote-*` channels behind `window.owlto.remote`. */
export function registerRemoteIpc(handle: IpcHandle, remote: RemoteService): void {
  handle('remote-overview', () => remote.overview())
  handle('remote-set-access', (input) => remote.setAccess(z.boolean().parse(input)))
  handle('remote-set-relay', (input) => remote.setRelay(z.boolean().parse(input)))
  handle('remote-start-pairing', () => remote.startPairing())
  handle('remote-cancel-pairing', () => remote.cancelPairing())
  handle('remote-set-keep-awake', (input) => remote.setKeepAwake(z.boolean().parse(input)))
  handle('remote-dismiss-just-paired', () => remote.dismissJustPaired())
  handle('remote-revoke-client', (input) => remote.revokeClient(deviceIdSchema.parse(input)))
  handle('remote-pair', (input) => remote.pair(input))
  handle('remote-remove-device', (input) => remote.removeDevice(deviceIdSchema.parse(input)))
  handle('remote-relay-sign-in', (input) =>
    remote.relaySignIn(remoteRelayProviderSchema.parse(input))
  )
  handle('remote-relay-cancel-sign-in', () => remote.relayCancelSignIn())
  handle('remote-relay-sign-out', () => remote.relaySignOut())
  handle('remote-relay-macs', () => remote.relayMacs())
  handle('remote-relay-remove-mac', (input) =>
    remote.relayRemoveMac(relayMailboxSchema.parse(input))
  )
  handle('remote-call', (input) => {
    const { deviceId, method, params } = remoteCallSchema.parse(input)
    return remote.call(deviceId, method, params)
  })
}
