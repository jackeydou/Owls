import { join } from 'node:path'
import { app, type BrowserWindow, nativeImage } from 'electron'
import type { AppLogo } from '../../shared/codex.js'

/**
 * Applies the logo to the running app. The bundle's own icon stays as shipped, because
 * rewriting it would invalidate the code signature, so Finder and a closed Dock tile keep it.
 */
export function applyAppLogo(logo: AppLogo, window: BrowserWindow | null): void {
  const image = nativeImage.createFromPath(
    join(app.getAppPath(), 'resources', 'app-logos', `${logo}.png`)
  )
  if (image.isEmpty()) return
  app.dock?.setIcon(image)
  if (process.platform !== 'darwin') window?.setIcon(image)
}
