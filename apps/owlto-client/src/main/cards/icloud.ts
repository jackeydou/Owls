import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { NotesICloudStatus, NotesICloudUnavailable } from '../../shared/cards.js'

/**
 * Owlto's iCloud container. The Mac app and the iPhone app both list it in their
 * entitlements, so they share one Documents folder, which iCloud Drive shows as "Owlto".
 */
export const NOTES_ICLOUD_CONTAINER = 'iCloud.dev.owlto.app'

/** The part of `@owlto/mac-icloud` Owlto uses. */
type ICloudBinding = {
  identityAvailable(): boolean
  containerPath(identifier: string): Promise<string | null>
  startDownloading(path: string): void
}

/** The helper, or why there is none: another platform, or a build that lacks it. */
export type ICloudBindingLoad =
  | { binding: ICloudBinding }
  | { reason: Extract<NotesICloudUnavailable, 'unsupported' | 'helper_missing'> }

/** Owlto's iCloud container on this Mac: whether it can be used, and where it is. */
export type ICloudAccess = {
  /** Checks again; the first check also sets the container up. */
  status(): Promise<{ icloud: NotesICloudStatus; container: string | null }>
  /** Asks iCloud to download a file it keeps only in the cloud. */
  startDownloading(path: string): void
}

/** Where macOS keeps a container's files: `iCloud.a.b` lives in `iCloud~a~b`. */
export function expectedContainerFolder(home = homedir()): string {
  return join(home, 'Library', 'Mobile Documents', NOTES_ICLOUD_CONTAINER.replaceAll('.', '~'))
}

/** The notes folder inside a container. */
export function icloudNotesFolder(container: string): string {
  return join(container, 'Documents', 'Notes')
}

/**
 * Loads the native binding only when the iCloud setting needs it: the package exists only
 * for macOS on Apple silicon and throws when it is loaded anywhere else, so this cannot be
 * a top-level import.
 */
function loadBinding(): ICloudBindingLoad {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') return { reason: 'unsupported' }
  try {
    return { binding: createRequire(__filename)('@owlto/mac-icloud') as ICloudBinding }
  } catch (error) {
    console.warn('[notes] the iCloud helper did not load:', (error as Error).message)
    return { reason: 'helper_missing' }
  }
}

export function createICloudAccess(load: () => ICloudBindingLoad = loadBinding): ICloudAccess {
  let loaded: ICloudBindingLoad | undefined
  const native = () => {
    if (loaded === undefined) loaded = load()
    return loaded
  }
  return {
    async status() {
      const result = native()
      if (!('binding' in result))
        return { icloud: { status: 'unavailable', reason: result.reason }, container: null }
      const icloud = result.binding
      if (!icloud.identityAvailable())
        return { icloud: { status: 'unavailable', reason: 'signed_out' }, container: null }
      const container = await icloud.containerPath(NOTES_ICLOUD_CONTAINER)
      // Signed in, yet no container: this build does not carry the iCloud entitlement.
      if (!container)
        return { icloud: { status: 'unavailable', reason: 'not_entitled' }, container: null }
      return { icloud: { status: 'available' }, container }
    },
    startDownloading(path) {
      try {
        const result = native()
        if ('binding' in result) result.binding.startDownloading(path)
      } catch (error) {
        console.warn('[notes] iCloud did not start a download:', (error as Error).message)
      }
    }
  }
}
