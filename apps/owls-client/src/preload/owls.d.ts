import type { OwlsAPI } from '../shared/app.js'

declare global {
  interface Window {
    owls: OwlsAPI
    owlsPlatform: 'darwin' | 'win32' | 'linux' | 'other'
  }
}
