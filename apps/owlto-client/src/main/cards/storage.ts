import type { NotesLocation } from '../../shared/app.js'
import type { NotesICloudStatus, NotesStorage, NotesStorageSwitch } from '../../shared/cards.js'
import { OwltoError } from '../app/errors.js'
import { expectedContainerFolder, type ICloudAccess, icloudNotesFolder } from './icloud.js'
import type { CardService } from './service.js'
import { pendingNotes, transferNotes } from './transfer.js'

type Deps = {
  /** The notes folder on this Mac (`notesHome()`). */
  localFolder: string
  icloud: ICloudAccess
  location: () => NotesLocation
  saveLocation: (location: NotesLocation) => void
  /** Tells the agents that read notes where the folder is now. */
  folderChanged: (folder: string) => void
  /** Where macOS keeps Owlto's container; a parameter so tests can point it elsewhere. */
  expectedContainer?: string
}

/**
 * Where notes live: the local notes folder, or the Notes folder in Owlto's iCloud container.
 * Switching moves the files; the store's index keeps ids, versions, and board places.
 */
export class NotesStorageService {
  private cards: CardService | null = null
  constructor(private readonly deps: Deps) {}

  /**
   * The folder to open at startup. For iCloud this is where macOS keeps the container, known
   * without asking iCloud (which can take a while); `start` checks it once the app is up.
   */
  startFolder(): string {
    if (this.deps.location() !== 'icloud') return this.deps.localFolder
    return icloudNotesFolder(this.deps.expectedContainer ?? expectedContainerFolder())
  }

  /**
   * Checks iCloud when notes live there: the first check sets the container up for this
   * launch, and a container somewhere else than expected moves the store to it.
   */
  async start(cards: CardService): Promise<void> {
    this.cards = cards
    if (this.deps.location() !== 'icloud') return
    const { container } = await this.deps.icloud.status()
    if (!container) return
    const folder = icloudNotesFolder(container)
    if (folder !== cards.folder()) {
      cards.relocate(folder, () => undefined)
      this.deps.folderChanged(folder)
    }
  }

  async storage(): Promise<NotesStorage> {
    const { icloud } = await this.deps.icloud.status()
    return this.describe(icloud)
  }

  /**
   * Moves notes into iCloud, or copies them back to this Mac. Copying back leaves the iCloud
   * files, so the user's other devices keep their notes.
   */
  async setLocation(location: NotesLocation): Promise<NotesStorageSwitch> {
    const cards = this.requireCards()
    const { icloud, container } = await this.deps.icloud.status()
    if (location === this.deps.location()) {
      return { result: 'moved', storage: this.describe(icloud), moved: 0 }
    }
    let target: string
    if (location === 'icloud') {
      if (!container) throw new OwltoError('request_unavailable', 'iCloud is not available.')
      target = icloudNotesFolder(container)
    } else {
      target = this.deps.localFolder
    }
    const from = cards.folder()
    const download = (path: string) => this.deps.icloud.startDownloading(path)
    // Out of iCloud, every note must be on this Mac first, or the copy would leave it out.
    const pending = location === 'local' ? pendingNotes(from, download) : 0
    if (pending > 0) return { result: 'downloading', storage: this.describe(icloud), pending }
    const mode = location === 'icloud' ? 'move' : 'copy'
    const { moved } = cards.relocate(target, () => transferNotes(from, target, mode, download))
    this.deps.saveLocation(location)
    this.deps.folderChanged(target)
    return { result: 'moved', storage: this.describe(icloud), moved }
  }

  private describe(icloud: NotesICloudStatus): NotesStorage {
    const folder = this.cards?.folder() ?? this.startFolder()
    return { location: this.deps.location(), folder, icloud }
  }

  private requireCards(): CardService {
    if (!this.cards) throw new OwltoError('router_unavailable', 'Notes are not available.')
    return this.cards
  }
}
