import { useI18n } from '@renderer/lib/i18n'
import { Check, Image, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ImageGenerationConfigStatus } from '../../../../shared/image-generation-config'
import {
  SettingsButton,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsTextInput
} from './settings-ui'

export function ImageGenerationModelSection(): React.JSX.Element {
  const { t } = useI18n()
  const [status, setStatus] = useState<ImageGenerationConfigStatus | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.api.imageGenerationConfig
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

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      setStatus(await window.api.imageGenerationConfig.save(apiKey))
      setApiKey('')
      setSaved(true)
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value))
    } finally {
      setSaving(false)
    }
  }

  const clear = async (): Promise<void> => {
    if (!window.confirm(t('models.imageGeneration.clearConfirm'))) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      setStatus(await window.api.imageGenerationConfig.clear())
      setApiKey('')
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value))
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsSection
      title={t('models.imageGeneration.title')}
      description={t('models.imageGeneration.description')}
    >
      <SettingsCard>
        <SettingsRow
          label={t('models.imageGeneration.model')}
          description={
            status?.authSource === 'openai-oauth'
              ? t('models.imageGeneration.providerOAuth')
              : t('models.imageGeneration.provider')
          }
        >
          <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <Image className="size-3.5" />
            <span className="font-mono">gpt-image-2</span>
            {status?.enabled ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-foreground/6 px-2 py-0.5 text-[11px]">
                <Check className="size-3" /> {t('models.imageGeneration.enabled')}
              </span>
            ) : null}
          </div>
        </SettingsRow>
        <SettingsRow
          label={t('models.imageGeneration.apiKey')}
          description={
            status?.authSource === 'openai-oauth'
              ? t('models.imageGeneration.oauthActive')
              : status?.hasApiKey
                ? t('models.imageGeneration.apiKeyConfigured')
                : t('models.imageGeneration.apiKeyOptional')
          }
          className="items-start"
        >
          <div className="flex w-[360px] flex-col items-end gap-2">
            <div className="flex w-full gap-2">
              <SettingsTextInput
                className="min-w-0 flex-1 font-mono"
                type="password"
                autoComplete="off"
                placeholder={
                  status?.hasApiKey
                    ? t('models.imageGeneration.apiKeyReplace')
                    : t('models.imageGeneration.apiKeyPlaceholder')
                }
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value)
                  setSaved(false)
                }}
                aria-label={t('models.imageGeneration.apiKey')}
              />
              <SettingsButton
                variant="primary"
                disabled={saving || !apiKey.trim()}
                onClick={() => void save()}
              >
                {saving ? t('models.saving') : t('models.save')}
              </SettingsButton>
              {status?.hasApiKey ? (
                <SettingsButton
                  className="px-2"
                  variant="danger"
                  disabled={saving}
                  onClick={() => void clear()}
                  aria-label={t('models.imageGeneration.clear')}
                >
                  <Trash2 className="size-3.5" />
                </SettingsButton>
              ) : null}
            </div>
            {error ? <p className="text-[12.5px] text-destructive">{error}</p> : null}
            {saved ? (
              <p className="text-[12.5px] text-muted-foreground">
                {t('models.imageGeneration.saved')}
              </p>
            ) : null}
          </div>
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  )
}
