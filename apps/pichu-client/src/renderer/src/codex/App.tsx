import { IconButton } from '@renderer/components/ui/icon-button'
import i18next from 'i18next'
import { AlertCircle, Loader2, X } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { RouterShell } from '../router/RouterShell'
import { failureMessage } from './failures'
import { useCodexStore } from './store'
import './codex.css'

export default function CodexApp() {
  const { t } = useTranslation()
  const { loaded, settings, error, initialize, event, clearError } = useCodexStore()
  useEffect(() => {
    const unsubscribe = window.codex.onEvent(event)
    void initialize()
    return unsubscribe
  }, [initialize, event])
  useEffect(() => {
    void i18next.changeLanguage(settings.language)
  }, [settings.language])
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const theme =
        settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : settings.theme
      document.documentElement.dataset.theme = theme
      document.documentElement.style.colorScheme = theme
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [settings.theme])
  return (
    <div className="codex-app">
      {loaded ? (
        <RouterShell />
      ) : (
        <main className="codex-loading" role="status">
          <Loader2 size={20} className="animate-spin" />
          {t('loading')}
        </main>
      )}
      {error ? (
        <div className="codex-error-toast" role="alert">
          <AlertCircle size={16} />
          <span>{failureMessage(error)}</span>
          <IconButton
            size="sm"
            label={t('dismissError')}
            icon={<X size={14} />}
            onClick={clearError}
          />
        </div>
      ) : null}
    </div>
  )
}
