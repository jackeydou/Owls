import { type BrowserWindow, screen } from 'electron'
import {
  readWindowState,
  restorableBounds,
  type WindowRect,
  writeWindowState
} from './window-state.js'

/** Waits for a resize or move to settle before writing the file. */
const SAVE_DELAY_MS = 500

export interface InitialWindowState {
  /** Position is left out when Owlto should center the window. */
  bounds: Partial<Pick<WindowRect, 'x' | 'y'>> & Pick<WindowRect, 'width' | 'height'>
  maximized: boolean
}

/**
 * Where the main window opens: where the user left it, or maximized to fill the screen
 * on first launch. `fallback` is the size un-maximizing returns to when nothing was saved.
 */
export function initialWindowState(
  path: string,
  fallback: { width: number; height: number },
  minimum: { width: number; height: number }
): InitialWindowState {
  const saved = readWindowState(path)
  if (!saved) return { bounds: fallback, maximized: true }
  const areas = screen.getAllDisplays().map((display) => display.workArea)
  const bounds = restorableBounds(saved.bounds, areas, minimum)
  return { bounds: bounds ?? fallback, maximized: saved.maximized }
}

/** Saves the window's size, place, and maximized state as the user changes them. */
export function rememberWindowState(window: BrowserWindow, path: string): void {
  let timer: NodeJS.Timeout | null = null
  const save = () => {
    if (timer) clearTimeout(timer)
    timer = null
    if (window.isDestroyed()) return
    try {
      writeWindowState(path, {
        bounds: window.getNormalBounds(),
        maximized: window.isMaximized() || window.isFullScreen()
      })
    } catch (error) {
      console.warn(
        'Owlto could not save the window size:',
        error instanceof Error ? error.message : error
      )
    }
  }
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(save, SAVE_DELAY_MS)
  }
  window.on('resize', schedule)
  window.on('move', schedule)
  window.on('maximize', schedule)
  window.on('unmaximize', schedule)
  window.on('enter-full-screen', schedule)
  window.on('leave-full-screen', schedule)
  window.on('close', save)
  window.on('closed', () => {
    if (timer) clearTimeout(timer)
  })
}
