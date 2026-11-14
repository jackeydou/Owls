import type { OwltoAPI } from '../shared/app.js'

declare global {
  interface Window {
    owlto: OwltoAPI
    owltoPlatform: 'darwin' | 'win32' | 'linux' | 'other'
  }
}
