import { IconButton } from '@renderer/components/ui/icon-button'
import { AlertCircleIcon, LoaderIcon, XIcon } from '@renderer/components/ui/icons'
import i18next from 'i18next'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { RouterShell } from '../router/RouterShell'
import { UpdatePopup } from '../updates/UpdatePopup'
import { failureMessage } from './failures'
import { MenuCommands } from './MenuCommands'
import { useAppStore } from './store'
import './app.css'

export default function App() {
  const { t } = useTranslation()
  const { loaded, settings, error, initialize, event, clearError } = useAppStore()
  useEffect(() => {
    const unsubscribe = window.owls.onEvent(event)
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
    <div className="owls-app">
      {loaded ? (
        <RouterShell />
      ) : (
        <main className="owls-loading" role="status">
          <LoaderIcon size={22} className="animate-spin" />
          {t('loading')}
        </main>
      )}
      {loaded ? <MenuCommands /> : null}
      {loaded ? <UpdatePopup /> : null}
      {error ? (
        <div className="owls-error-toast" role="alert">
          <AlertCircleIcon size={18} />
          <span>{failureMessage(error)}</span>
          <IconButton
            size="sm"
            label={t('dismissError')}
            icon={<XIcon size={16} />}
            onClick={clearError}
          />
        </div>
      ) : null}
    </div>
  )
}
