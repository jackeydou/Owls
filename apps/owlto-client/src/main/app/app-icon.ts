import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { nativeImage } from 'electron'
import { bundleIconFile } from './open-in.js'

const execFileAsync = promisify(execFile)

/** Icons are drawn at 18px in the menu, so 64px stays sharp on a Retina screen. */
const ICON_PX = 64

/**
 * Reads one key with `plutil -extract … raw` (macOS 12+, the oldest macOS this
 * Electron runs on). Converting the whole plist to JSON would fail on the date
 * or data values some bundles carry.
 */
async function readInfo(appPath: string): Promise<unknown> {
  const { stdout } = await execFileAsync(
    'plutil',
    ['-extract', 'CFBundleIconFile', 'raw', '-o', '-', join(appPath, 'Contents', 'Info.plist')],
    { timeout: 3000 }
  )
  return { CFBundleIconFile: stdout.trim() }
}

/** Converts the bundle's own `.icns` to a PNG with `sips`, which every Mac ships. */
async function icnsIcon(appPath: string): Promise<string | null> {
  const file = bundleIconFile(await readInfo(appPath))
  if (!file) return null
  const dir = await mkdtemp(join(tmpdir(), 'owlto-icon-'))
  try {
    const out = join(dir, 'icon.png')
    await execFileAsync(
      'sips',
      [
        '-s',
        'format',
        'png',
        '-Z',
        String(ICON_PX),
        join(appPath, 'Contents', 'Resources', file),
        '--out',
        out
      ],
      { timeout: 5000 }
    )
    return `data:image/png;base64,${(await readFile(out)).toString('base64')}`
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** QuickLook draws an app bundle as its icon, including apps whose icon lives only in Assets.car. */
async function quickLookIcon(appPath: string): Promise<string | null> {
  const image = await nativeImage.createThumbnailFromPath(appPath, {
    width: ICON_PX,
    height: ICON_PX
  })
  return image.isEmpty() ? null : image.toDataURL()
}

/**
 * A macOS app's own icon as a PNG data URL, or null.
 *
 * `app.getFileIcon` is not used: on macOS it looks icons up by file extension,
 * so every `.app` comes back as the same generic placeholder.
 */
export async function macAppIcon(appPath: string): Promise<string | null> {
  try {
    const icon = await icnsIcon(appPath)
    if (icon) return icon
  } catch {
    // Fall through to QuickLook: a missing or unreadable .icns is common for newer apps.
  }
  try {
    return await quickLookIcon(appPath)
  } catch {
    return null
  }
}
