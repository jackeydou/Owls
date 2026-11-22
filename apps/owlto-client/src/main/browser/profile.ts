/**
 * The Electron session behind Owlto's browser tabs: where sign-ins live, where downloads go,
 * and what pages may ask for. Each worker's downloads land in a folder of its own, and the
 * worker's next browser call reports their paths.
 */
import { existsSync, mkdirSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { app, type Session, session } from 'electron'

export type DownloadsReport = {
  /** Files that finished since the last report, as full paths. */
  done: string[]
  /** File names still downloading. */
  pending: string[]
}

export type BrowserProfileDeps = {
  /** Owlto's browser folder in the data root: its session lives here. */
  home: () => string
  /** The downloads folder: the user's choice, or Owlto's default. */
  downloadsRoot: () => string
  /** The worker that owns a page, or null for the user's own tabs. */
  ownerOf: (webContentsId: number) => string | null
}

/** The folder a worker's downloads go to, under the downloads root. */
export function workerDownloadsDir(root: string, key: string): string {
  return join(root, key.replace(/[^\w.-]/g, '_'))
}

export class BrowserProfile {
  private current: Session | null = null
  private readonly done = new Map<string, string[]>()
  private readonly pending = new Map<string, Set<string>>()

  constructor(private readonly deps: BrowserProfileDeps) {}

  session(): Session {
    if (this.current) return this.current
    const browserSession = session.fromPath(join(this.deps.home(), 'session'))
    // Pages ask for nothing: camera, location, notifications and the like are refused.
    browserSession.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false)
    )
    browserSession.setPermissionCheckHandler(() => false)
    browserSession.on('will-download', (_event, item, contents) => {
      const key = contents ? this.deps.ownerOf(contents.id) : null
      const root = this.deps.downloadsRoot()
      const dir = key ? workerDownloadsDir(root, key) : root
      mkdirSync(dir, { recursive: true })
      const path = uniquePath(dir, item.getFilename())
      item.setSavePath(path)
      if (!key) return
      const name = basename(path)
      const pending = this.pending.get(key) ?? new Set<string>()
      pending.add(name)
      this.pending.set(key, pending)
      item.once('done', (_done, state) => {
        pending.delete(name)
        if (state !== 'completed') return
        const done = this.done.get(key) ?? []
        done.push(path)
        this.done.set(key, done)
      })
    })
    browserSession.setUserAgent(
      browserSession.getUserAgent().replace(/\s(Owlto|Electron)\/\S+/g, ''),
      app.getLocale()
    )
    this.current = browserSession
    return browserSession
  }

  /** The worker's downloads since the last call; finished ones are reported once. */
  takeDownloads(key: string): DownloadsReport {
    const done = this.done.get(key) ?? []
    this.done.delete(key)
    return { done, pending: [...(this.pending.get(key) ?? [])].sort() }
  }

  forgetWorker(key: string): void {
    this.done.delete(key)
    this.pending.delete(key)
  }

  /** Whether the session holds cookies for the URL, which is how a sign-in shows. */
  async signedIn(url: string): Promise<boolean> {
    const cookies = await this.session()
      .cookies.get({ url })
      .catch(() => [])
    return cookies.length > 0
  }

  /** Signs out of every site: cookies, storage, and the cache. */
  async clearSignIns(): Promise<void> {
    const target = this.session()
    await target.clearStorageData()
    await target.clearCache()
    await target.clearAuthCache()
  }
}

/** `name` in `dir`, numbered like `report (2).pdf` when that name is taken. */
function uniquePath(dir: string, name: string): string {
  const safe = basename(name).replace(/^\.+/, '') || 'download'
  const ext = extname(safe)
  const stem = safe.slice(0, safe.length - ext.length)
  let path = join(dir, safe)
  for (let n = 2; existsSync(path); n++) path = join(dir, `${stem} (${n})${ext}`)
  return path
}
