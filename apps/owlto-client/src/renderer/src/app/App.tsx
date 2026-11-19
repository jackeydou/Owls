import { IconButton } from '@renderer/components/ui/icon-button'
import { AlertCircleIcon, LoaderIcon, XIcon } from '@renderer/components/ui/icons'
import i18next from 'i18next'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { isRemoteEvent } from '../../../shared/remote'
import { Onboarding } from '../onboarding/Onboarding'
import { OnboardingHost } from '../onboarding/state'
import { viewingDevice } from '../remote/viewing'
import { OpenWorkerFromNotification } from '../router/OpenWorkerFromNotification'
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
    // While another device's Router is shown, its events replace this Mac's Router events.
    const offLocal = window.owlto.onEvent((appEvent) => {
      if (!viewingDevice() || !isRemoteEvent(appEvent)) event(appEvent)
    })
    const offRemote = window.owlto.remote.onEvent((envelope) => {
      if (viewingDevice() === envelope.deviceId) event(envelope.event)
    })
    void initialize()
    return () => {
      offLocal()
      offRemote()
    }
  }, [initialize, event])
  useEffect(() => {
    void i18next.changeLanguage(settings.language)
    document.documentElement.lang = settings.language
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
  useEffect(() => {
    document.documentElement.dataset.skin = settings.skin
  }, [settings.skin])
  return (
    <div className="owlto-app">
      {loaded ? (
        <RouterShell />
      ) : (
        <main className="owlto-loading" role="status">
          <LoaderIcon size={22} className="animate-spin" />
          {t('loading')}
        </main>
      )}
      {loaded ? <MenuCommands /> : null}
      {loaded ? <OnboardingHost /> : null}
      {loaded ? <Onboarding /> : null}
      <OpenWorkerFromNotification />
      {loaded ? <UpdatePopup /> : null}
      {error ? (
        <div className="owlto-error-toast" role="alert">
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
