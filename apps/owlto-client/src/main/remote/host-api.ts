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
    sendRouter: async (input) => {
      await host.sendRouter(input)
    },
    stageAttachment: (input) => host.stageAttachment(input),
    interruptRouter: (routerId) => host.interruptRouter(routerId),
    archiveThread: (input) => host.archiveThread(input),
    renameThread: (input) => host.renameThread(input),
    pinThread: (input) => host.pinThread(input),
    resolveBatch: (input) => host.resolveBatch(input),
    stopWorker: (input) => host.stopWorker(input),
    resolveWorker: (input) => host.resolveWorker(input),
    steerPendingMessage: (input) => host.steerPending(input),
    dropPendingMessage: (input) => host.dropPending(input),
    respond: (input) => host.respond(input),
    previewFile: (input) => host.previewFile(input)
  }
}
