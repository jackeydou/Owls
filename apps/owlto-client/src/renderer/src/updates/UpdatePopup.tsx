import { ActionButton } from '@renderer/components/ui/action-button'
import { Button } from '@renderer/components/ui/button'
import { IconButton } from '@renderer/components/ui/icon-button'
import { DownloadIcon, RotateCcwIcon, XIcon } from '@renderer/components/ui/icons'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { installUpdate } from './update-actions'
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
  const state = snapshot?.state
  if (state?.status !== 'ready' || dismissed === state.version) return null
  return (
    <section className="owlto-update-popup" aria-labelledby="owlto-update-popup-title">
      <div className="owlto-update-popup-icon" aria-hidden>
        <DownloadIcon size={18} />
      </div>
      <div className="owlto-update-popup-body">
        <h2 id="owlto-update-popup-title">{t('updates.popup.title')}</h2>
        <p>{t('updates.popup.body', { version: state.version })}</p>
        <div className="owlto-update-popup-actions">
          <ActionButton
            size="sm"
            icon={<RotateCcwIcon size={15} aria-hidden />}
            onAction={installUpdate}
          >
            {t('updates.popup.update')}
          </ActionButton>
          <Button size="sm" variant="ghost" onClick={() => setDismissed(state.version)}>
            {t('updates.popup.later')}
          </Button>
        </div>
      </div>
      <IconButton
        size="sm"
        className="owlto-update-popup-close"
        label={t('updates.popup.dismiss')}
        icon={<XIcon size={16} />}
        onClick={() => setDismissed(state.version)}
      />
    </section>
  )
}
