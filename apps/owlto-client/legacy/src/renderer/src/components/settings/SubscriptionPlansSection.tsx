import { useI18n } from '@renderer/lib/i18n'
import { Check, ExternalLink, LogOut } from 'lucide-react'
import { useEffect, useState } from 'react'
import openAiLogo from '../../../../../resources/openai.svg?asset'
import type { OpenAIOAuthStatus } from '../../../../shared/openai-oauth'
import {
  SettingsButton,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSwitch
} from './settings-ui'

export function SubscriptionPlansSection({
  onModelsChanged
}: {
  onModelsChanged: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [status, setStatus] = useState<OpenAIOAuthStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [pendingModelId, setPendingModelId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.openAIOAuth
      .get()
      .then((value) => {
        if (!cancelled) setStatus(value)
      })
      .catch((value) => {
        if (!cancelled) setError(value instanceof Error ? value.message : String(value))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const login = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setStatus(await window.api.openAIOAuth.login())
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value))
    } finally {
      setBusy(false)
    }
  }

  const logout = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setStatus(await window.api.openAIOAuth.logout())
      onModelsChanged()
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value))
    } finally {
      setBusy(false)
    }
  }

  const toggleModel = async (modelId: string): Promise<void> => {
    if (!status) return
    setPendingModelId(modelId)
    setError(null)
    try {
      const enabledIds = status.models
        .filter((model) => (model.id === modelId ? !model.enabled : model.enabled))
        .map((model) => model.id)
      setStatus(await window.api.openAIOAuth.setEnabledModels(enabledIds))
      onModelsChanged()
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value))
    } finally {
      setPendingModelId(null)
    }
  }

  return (
    <SettingsSection
      title={t('models.subscriptions.title')}
      description={t('models.subscriptions.description')}
    >
      <SettingsCard>
        <div
          className={`flex min-h-[84px] items-center justify-between gap-6 px-4 py-3.5 ${
            status?.signedIn ? 'border-b border-border/55' : ''
          }`}
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-foreground/[0.035]">
              <img
                src={openAiLogo}
                alt=""
                className="size-6 text-foreground dark:invert"
                aria-hidden="true"
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-[14px] font-medium leading-5 text-foreground">OpenAI</h3>
                {status?.signedIn ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-foreground/6 px-2 py-0.5 text-[11px] text-muted-foreground">
                    <Check className="size-3" /> {t('models.openaiOAuth.signedIn')}
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 text-[12.5px] leading-[1.4] text-muted-foreground">
                {status?.signedIn
                  ? t('models.openaiOAuth.signedInDescription')
                  : t('models.openaiOAuth.signedOutDescription')}
              </p>
            </div>
          </div>
          {status?.signedIn ? (
            <SettingsButton variant="danger" disabled={busy} onClick={() => void logout()}>
              <LogOut className="size-3.5" />
              {t('models.openaiOAuth.signOut')}
            </SettingsButton>
          ) : (
            <SettingsButton variant="primary" disabled={busy} onClick={() => void login()}>
              <ExternalLink className="size-3.5" />
              {busy ? t('models.openaiOAuth.signingIn') : t('models.openaiOAuth.signIn')}
            </SettingsButton>
          )}
        </div>
        {status?.signedIn
          ? status.models.map((model) => (
              <SettingsRow
                key={model.id}
                label={
                  <span className="inline-flex items-center gap-2">
                    {model.name}
                    {model.kind === 'image' ? (
                      <span className="rounded-full bg-foreground/6 px-2 py-0.5 text-[10.5px] font-normal text-muted-foreground">
                        {t('models.subscriptions.experimental')}
                      </span>
                    ) : null}
                  </span>
                }
                description={
                  model.kind === 'image' ? t('models.openaiOAuth.imageModelDescription') : model.id
                }
              >
                <SettingsSwitch
                  checked={model.enabled}
                  disabled={pendingModelId !== null}
                  onClick={() => void toggleModel(model.id)}
                />
              </SettingsRow>
            ))
          : null}
      </SettingsCard>
      {error ? <p className="mt-3 text-[12.5px] text-destructive">{error}</p> : null}
    </SettingsSection>
  )
}
