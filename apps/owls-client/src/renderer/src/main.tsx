import './assets/main.css'
import './app/i18n'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/App'

document.documentElement.dataset.platform = window.owlsPlatform

const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('Root element #root not found')
}
createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>
)
