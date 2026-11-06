import type { CodexAPI } from '../shared/codex.js'

declare global {
  interface Window {
    codex: CodexAPI
    owlsPlatform: 'darwin' | 'win32' | 'linux' | 'other'
  }
}
