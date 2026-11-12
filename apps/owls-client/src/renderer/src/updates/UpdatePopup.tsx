import { Button } from '@renderer/components/ui/button'
import { IconButton } from '@renderer/components/ui/icon-button'
import { DownloadIcon, RotateCcwIcon, XIcon } from '@renderer/components/ui/icons'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUpdateSnapshot } from './use-update-snapshot'
import './updates.css'

/**
 * Bottom-right notice for a downloaded update. Dismissing hides it for that version until the
 * app restarts; a newer staged version shows it again. Settings > Updates keeps the same action.
 */
export function UpdatePopup() {
  const { t } = useTranslation()
  const snapshot = useUpdateSnapshot()
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)
  const state = snapshot?.state
  if (state?.status !== 'ready' || dismissed === state.version) return null
  const install = async () => {
    setInstalling(true)
    try {
      // Resolves without quitting when the user keeps running tasks open.
      await window.owls.updates.install()
    } finally {
      setInstalling(false)
    }
  }
  return (
    <section className="owls-update-popup" aria-labelledby="owls-update-popup-title">
      <div className="owls-update-popup-icon" aria-hidden>
        <DownloadIcon size={18} />
      </div>
      <div className="owls-update-popup-body">
        <h2 id="owls-update-popup-title">{t('updates.popup.title')}</h2>
        <p>{t('updates.popup.body', { version: state.version })}</p>
        <div className="owls-update-popup-actions">
          <Button size="sm" disabled={installing} onClick={() => void install()}>
            <RotateCcwIcon size={15} aria-hidden />
            {t('updates.popup.update')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDismissed(state.version)}>
            {t('updates.popup.later')}
          </Button>
        </div>
      </div>
      <IconButton
        size="sm"
        className="owls-update-popup-close"
        label={t('updates.popup.dismiss')}
        icon={<XIcon size={16} />}
        onClick={() => setDismissed(state.version)}
      />
    </section>
  )
}
