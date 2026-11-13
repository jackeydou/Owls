import { z } from 'zod'
import { workerActionSchema } from './router.js'

/**
 * Apps a worker's folder can open in. The ids are stable: the last choice is
 * saved in settings. Only installed apps are offered.
 */
export const openInAppIds = [
  'vscode',
  'cursor',
  'windsurf',
  'zed',
  'sublime',
  'nova',
  'xcode',
  'android-studio',
  'intellij',
  'webstorm',
  'pycharm',
  'goland',
  'clion',
  'phpstorm',
  'rider',
  'rubymine',
  'rustrover',
  'emacs',
  'macvim',
  'finder',
  'terminal',
  'iterm',
  'ghostty',
  'warp'
] as const
export const openInAppIdSchema = z.enum(openInAppIds)
export type OpenInAppId = z.infer<typeof openInAppIdSchema>
/** Editors first, then the file manager and terminals, each after a separator in the menu. */
export type OpenInAppKind = 'editor' | 'files' | 'terminal'

/** An installed app; `icon` is its own icon as a PNG data URL, null when it could not be read. */
export type OpenInApp = {
  id: OpenInAppId
  name: string
  kind: OpenInAppKind
  icon: string | null
}

export const openWorkerInSchema = workerActionSchema.extend({ appId: openInAppIdSchema })
export type OpenWorkerIn = z.infer<typeof openWorkerInSchema>
