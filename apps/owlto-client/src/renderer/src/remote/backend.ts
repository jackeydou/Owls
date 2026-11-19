import type { Reply } from '../../../shared/app'
import type { RemoteMethod, RemoteParams, RemoteResults } from '../../../shared/remote'
import { viewingDevice } from './viewing'

/**
 * The Router actions the window can run on whichever device it shows. On this Mac they
 * are the usual IPC calls; on a paired device each one goes through `window.owlto.remote`.
 */
export type Backend = {
  [M in RemoteMethod]: undefined extends RemoteParams[M]
    ? (params?: RemoteParams[M]) => Promise<Reply<RemoteResults[M]>>
    : (params: RemoteParams[M]) => Promise<Reply<RemoteResults[M]>>
}

const local: Backend = {
  snapshot: () => window.owlto.snapshot(),
  threadItems: (input) => window.owlto.threadItems(input),
  createThread: (input) => window.owlto.createThread(input),
  sendRouter: (input) => window.owlto.sendRouter({ cardIds: [], attachments: [], ...input }),
  interruptRouter: (routerId) => window.owlto.interruptRouter(routerId),
  archiveThread: (input) => window.owlto.archiveThread(input),
  resolveBatch: (input) => window.owlto.resolveBatch(input),
  stopWorker: (input) => window.owlto.stopWorker(input),
  steerPendingMessage: (input) => window.owlto.steerPendingMessage(input),
  dropPendingMessage: (input) => window.owlto.dropPendingMessage(input),
  respond: (input) => window.owlto.respond(input),
  previewFile: (input) => window.owlto.previewFile(input)
}

function remote(deviceId: string): Backend {
  const call =
    <M extends RemoteMethod>(method: M) =>
    (params?: RemoteParams[M]) =>
      window.owlto.remote.call({ deviceId, method, params: params as RemoteParams[M] })
  return {
    snapshot: call('snapshot'),
    threadItems: call('threadItems'),
    createThread: call('createThread'),
    sendRouter: call('sendRouter'),
    interruptRouter: call('interruptRouter'),
    archiveThread: call('archiveThread'),
    resolveBatch: call('resolveBatch'),
    stopWorker: call('stopWorker'),
    steerPendingMessage: call('steerPendingMessage'),
    dropPendingMessage: call('dropPendingMessage'),
    respond: call('respond'),
    previewFile: call('previewFile')
  }
}

/** The backend for the device the window shows right now. */
export function backend(): Backend {
  const deviceId = viewingDevice()
  return deviceId ? remote(deviceId) : local
}
