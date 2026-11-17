import { Button } from '@renderer/components/ui/button'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../app/store'
import { OwlFlock } from './OwlFlock'
import { useAnythingConfigured, useStartupSettled } from './state'
import { useOnboardingStore } from './store'
import './onboarding.css'

/** True while the thread page should offer the skipped onboarding again. */
export function useSetupCardVisible(): boolean {
  const skipped = useAppStore((s) => s.settings.onboarding === 'skipped')
  const settled = useStartupSettled()
  const configured = useAnythingConfigured()
  return skipped && settled && !configured
}

/** After a skip: the owls ask to finish setting up, and reopen onboarding. */
export function SetupCard() {
  const { t } = useTranslation()
  const show = useOnboardingStore((s) => s.show)
  return (
    <section className="onb-setup-card" aria-labelledby="onb-setup-title">
      <div className="onb-setup-text">
        <strong id="onb-setup-title">{t('onboarding.cardTitle')}</strong>
        <p>{t('onboarding.cardBody')}</p>
        <Button size="sm" className="onb-primary" onClick={show}>
          {t('onboarding.cardAction')}
        </Button>
      </div>
      <OwlFlock compact />
    </section>
  )
}
