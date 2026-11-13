import { execFile } from 'node:child_process'
import { access, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { OpenInApp, OpenInAppId, OpenInAppKind } from '../../shared/open-in.js'
import { OwlsError } from './errors.js'

const execFileAsync = promisify(execFile)

type CatalogEntry = {
  id: OpenInAppId
  name: string
  kind: OpenInAppKind
  /** Bundle names to look for in the usual app folders, most common first. */
  bundles: string[]
  /** Bundle identifiers for a Spotlight lookup when the app lives elsewhere (e.g. JetBrains Toolbox). */
  bundleIds: string[]
}

/** The order here is the menu order. */
export const OPEN_IN_CATALOG: readonly CatalogEntry[] = [
  {
    id: 'vscode',
    name: 'VS Code',
    kind: 'editor',
    bundles: ['Visual Studio Code.app'],
    bundleIds: ['com.microsoft.VSCode']
  },
  {
    id: 'cursor',
    name: 'Cursor',
    kind: 'editor',
    bundles: ['Cursor.app'],
    bundleIds: ['com.todesktop.230313mzl4w4u92']
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    kind: 'editor',
    bundles: ['Windsurf.app'],
    bundleIds: ['com.exafunction.windsurf']
  },
  {
    id: 'zed',
    name: 'Zed',
    kind: 'editor',
    bundles: ['Zed.app', 'Zed Preview.app'],
    bundleIds: ['dev.zed.Zed', 'dev.zed.Zed-Preview']
  },
  {
    id: 'sublime',
    name: 'Sublime Text',
    kind: 'editor',
    bundles: ['Sublime Text.app'],
    bundleIds: ['com.sublimetext.4', 'com.sublimetext.3']
  },
  {
    id: 'nova',
    name: 'Nova',
    kind: 'editor',
    bundles: ['Nova.app'],
    bundleIds: ['com.panic.Nova']
  },
  {
    id: 'xcode',
    name: 'Xcode',
    kind: 'editor',
    bundles: ['Xcode.app'],
    bundleIds: ['com.apple.dt.Xcode']
  },
  {
    id: 'android-studio',
    name: 'Android Studio',
    kind: 'editor',
    bundles: ['Android Studio.app'],
    bundleIds: ['com.google.android.studio']
  },
  {
    id: 'intellij',
    name: 'IntelliJ IDEA',
    kind: 'editor',
    bundles: [
      'IntelliJ IDEA.app',
      'IntelliJ IDEA Ultimate.app',
      'IntelliJ IDEA CE.app',
      'IntelliJ IDEA Community Edition.app'
    ],
    bundleIds: ['com.jetbrains.intellij', 'com.jetbrains.intellij.ce']
  },
  {
    id: 'webstorm',
    name: 'WebStorm',
    kind: 'editor',
    bundles: ['WebStorm.app'],
    bundleIds: ['com.jetbrains.WebStorm']
  },
  {
    id: 'pycharm',
    name: 'PyCharm',
    kind: 'editor',
    bundles: [
      'PyCharm.app',
      'PyCharm Professional Edition.app',
      'PyCharm CE.app',
      'PyCharm Community Edition.app'
    ],
    bundleIds: ['com.jetbrains.pycharm', 'com.jetbrains.pycharm.ce']
  },
  {
    id: 'goland',
    name: 'GoLand',
    kind: 'editor',
    bundles: ['GoLand.app'],
    bundleIds: ['com.jetbrains.goland']
  },
  {
    id: 'clion',
    name: 'CLion',
    kind: 'editor',
    bundles: ['CLion.app'],
    bundleIds: ['com.jetbrains.CLion']
  },
  {
    id: 'phpstorm',
    name: 'PhpStorm',
    kind: 'editor',
    bundles: ['PhpStorm.app'],
    bundleIds: ['com.jetbrains.PhpStorm']
  },
  {
    id: 'rider',
    name: 'Rider',
    kind: 'editor',
    bundles: ['Rider.app'],
    bundleIds: ['com.jetbrains.rider']
  },
  {
    id: 'rubymine',
    name: 'RubyMine',
    kind: 'editor',
    bundles: ['RubyMine.app'],
    bundleIds: ['com.jetbrains.rubymine']
  },
  {
    id: 'rustrover',
    name: 'RustRover',
    kind: 'editor',
    bundles: ['RustRover.app'],
    bundleIds: ['com.jetbrains.rustrover']
  },
  {
    id: 'emacs',
    name: 'Emacs',
    kind: 'editor',
    bundles: ['Emacs.app'],
    bundleIds: ['org.gnu.Emacs']
  },
  {
    id: 'macvim',
    name: 'MacVim',
    kind: 'editor',
    bundles: ['MacVim.app'],
    bundleIds: ['org.vim.MacVim']
  },
  {
    id: 'finder',
    name: 'Finder',
    kind: 'files',
    bundles: ['Finder.app'],
    bundleIds: ['com.apple.finder']
  },
  {
    id: 'terminal',
    name: 'Terminal',
    kind: 'terminal',
    bundles: ['Terminal.app'],
    bundleIds: ['com.apple.Terminal']
  },
  {
    id: 'iterm',
    name: 'iTerm',
    kind: 'terminal',
    bundles: ['iTerm.app'],
    bundleIds: ['com.googlecode.iterm2']
  },
  {
    id: 'ghostty',
    name: 'Ghostty',
    kind: 'terminal',
    bundles: ['Ghostty.app'],
    bundleIds: ['com.mitchellh.ghostty']
  },
  {
    id: 'warp',
    name: 'Warp',
    kind: 'terminal',
    bundles: ['Warp.app'],
    bundleIds: ['dev.warp.Warp-Stable']
  }
]

/** Where macOS apps usually live; Finder and Terminal ship in the system folders. */
function appFolders(home: string): string[] {
  return [
    '/Applications',
    join(home, 'Applications'),
    '/System/Applications',
    '/System/Applications/Utilities',
    '/Applications/Utilities',
    '/System/Library/CoreServices'
  ]
}

/** The OS-facing pieces, so detection and opening can be tested without macOS. */
export type OpenInPlatform = {
  platform: NodeJS.Platform
  home: string
  exists: (path: string) => Promise<boolean>
  /** App bundle paths Spotlight knows for a bundle identifier. */
  spotlight: (bundleId: string) => Promise<string[]>
  /** The app's icon as a PNG data URL, or null. */
  icon: (appPath: string) => Promise<string | null>
  isFolder: (path: string) => Promise<boolean>
  open: (appPath: string, folder: string) => Promise<void>
}

export function nodeOpenInPlatform(icon: OpenInPlatform['icon']): OpenInPlatform {
  return {
    platform: process.platform,
    home: homedir(),
    exists: (path) =>
      access(path).then(
        () => true,
        () => false
      ),
    spotlight: async (bundleId) => {
      try {
        const { stdout } = await execFileAsync(
          'mdfind',
          [`kMDItemCFBundleIdentifier == "${bundleId}"`],
          { timeout: 3000 }
        )
        return stdout
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.endsWith('.app'))
          .sort()
      } catch {
        return []
      }
    },
    icon,
    isFolder: (path) =>
      stat(path).then(
        (s) => s.isDirectory(),
        () => false
      ),
    open: async (appPath, folder) => {
      await execFileAsync('open', ['-a', appPath, folder], { timeout: 10000 })
    }
  }
}

/** Installed apps are scanned again at most this often, so a new install shows up. */
const RESCAN_MS = 60_000

/**
 * Finds the editors, file manager, and terminals installed on this Mac and
 * opens a folder in one of them. Other platforms get no apps.
 */
export class OpenInApps {
  private scan: {
    at: number
    apps: Promise<Map<OpenInAppId, { app: OpenInApp; path: string }>>
  } | null = null
  constructor(
    private readonly os: OpenInPlatform,
    private readonly now: () => number = Date.now
  ) {}

  async list(): Promise<OpenInApp[]> {
    return [...(await this.installed()).values()].map((entry) => entry.app)
  }

  async open(appId: OpenInAppId, folder: string): Promise<void> {
    if (!(await this.os.isFolder(folder)))
      throw new OwlsError('request_unavailable', 'This folder no longer exists.')
    let entry = (await this.installed()).get(appId)
    if (!entry) {
      // The app may have been installed or moved since the last scan.
      this.scan = null
      entry = (await this.installed()).get(appId)
    }
    if (!entry) throw new OwlsError('request_unavailable', 'This app is not installed.')
    await this.os.open(entry.path, folder)
  }

  private installed(): Promise<Map<OpenInAppId, { app: OpenInApp; path: string }>> {
    if (!this.scan || this.now() - this.scan.at > RESCAN_MS) {
      const apps = this.detect()
      this.scan = { at: this.now(), apps }
      apps.catch(() => {
        if (this.scan?.apps === apps) this.scan = null
      })
    }
    return this.scan.apps
  }

  private async detect(): Promise<Map<OpenInAppId, { app: OpenInApp; path: string }>> {
    const found = new Map<OpenInAppId, { app: OpenInApp; path: string }>()
    if (this.os.platform !== 'darwin') return found
    const folders = appFolders(this.os.home)
    const paths = await Promise.all(OPEN_IN_CATALOG.map((entry) => this.locate(entry, folders)))
    const icons = await Promise.all(
      paths.map((path) => (path ? this.os.icon(path).catch(() => null) : null))
    )
    OPEN_IN_CATALOG.forEach((entry, index) => {
      const path = paths[index]
      if (!path) return
      found.set(entry.id, {
        path,
        app: { id: entry.id, name: entry.name, kind: entry.kind, icon: icons[index] ?? null }
      })
    })
    return found
  }

  private async locate(entry: CatalogEntry, folders: string[]): Promise<string | null> {
    for (const bundle of entry.bundles) {
      for (const folder of folders) {
        const path = join(folder, bundle)
        if (await this.os.exists(path)) return path
      }
    }
    for (const bundleId of entry.bundleIds) {
      const [path] = await this.os.spotlight(bundleId)
      if (path) return path
    }
    return null
  }
}
