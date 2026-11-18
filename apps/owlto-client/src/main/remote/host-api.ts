import type { OwltoHost } from '../app/host.js'
import type { RemoteHostApi } from './server.js'

/**
 * What a paired device may do on this one: read and drive threads and workers. Each
 * method calls the same host method the local window uses.
 */
export function remoteHostApi(host: OwltoHost): RemoteHostApi {
  return {
    snapshot: () => {
      const { settings: _settings, github: _github, ...rest } = host.snapshot()
      return rest
    },
    threadItems: (input) => host.threadItems(input),
    createThread: (input) => host.createThread(input),
    sendRouter: (input) => host.sendRouter(input),
    interruptRouter: (routerId) => host.interruptRouter(routerId),
    archiveThread: (input) => host.archiveThread(input),
    resolveBatch: (input) => host.resolveBatch(input),
    stopWorker: (input) => host.stopWorker(input),
    steerPendingMessage: (input) => host.steerPending(input),
    dropPendingMessage: (input) => host.dropPending(input),
    respond: (input) => host.respond(input),
    previewFile: (input) => host.previewFile(input)
  }
}
