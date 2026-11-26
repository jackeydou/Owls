import { notesLocationSchema } from '../../shared/app.js'
import type { IpcHandle } from '../app/ipc.js'
import type { NotesStorageService } from './storage.js'

/** Settings → Experiments: where notes live, and the switch that moves them. */
export function registerNotesStorageIpc(handle: IpcHandle, storage: NotesStorageService): void {
  handle('cards-storage', () => storage.storage())
  handle('cards-set-storage', (input) => storage.setLocation(notesLocationSchema.parse(input)))
}
