import { useI18n } from '@renderer/lib/i18n'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { Check, KeyRound, Pencil, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  MODEL_API_SPECS,
  type ModelApiSpec,
  type UserModelConfig,
  type UserModelSummary
} from '../../../../shared/model-config'
import { ImageGenerationModelSection } from './ImageGenerationModelSection'
import { SettingsDialog, SettingsDialogCancel } from './SettingsDialog'
import { SubscriptionPlansSection } from './SubscriptionPlansSection'
import {
  SettingsButton,
  SettingsCard,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
  SettingsTextInput
} from './settings-ui'

const EMPTY_MODEL: UserModelConfig = {
  id: '',
  name: '',
  api: 'openai-responses',
  baseUrl: '',
  apiKey: '',
  contextWindow: 128_000,
  maxTokens: 16_384,
  reasoning: false,
  supportsImages: false,
  source: 'custom'
}

function editableModel(model?: UserModelSummary): UserModelConfig {
  if (!model) return { ...EMPTY_MODEL }
  const { hasApiKey: _, ...config } = model
  return { ...config, apiKey: '' }
}

export function ModelsTab(): React.JSX.Element {
  const { t } = useI18n()
  const selectedModelId = useSettingsStore((state) => state.model)
  const updateModel = useSettingsStore((state) => state.updateModel)
  const loadSettings = useSettingsStore((state) => state.load)
  const [models, setModels] = useState<UserModelSummary[]>([])
  const [editing, setEditing] = useState<UserModelSummary | null | undefined>(undefined)
  const [draft, setDraft] = useState<UserModelConfig>(EMPTY_MODEL)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [refreshVersion, setRefreshVersion] = useState(0)

  const loadModels = useCallback((): void => {
    void window.api.models
      .list()
      .then(setModels)
      .catch((value) => setError(value instanceof Error ? value.message : String(value)))
  }, [])

  useEffect(() => {
    loadModels()
  }, [loadModels])

  const handleOAuthModelsChanged = (): void => {
    loadModels()
    setRefreshVersion((value) => value + 1)
    void loadSettings()
  }

  const openEditor = (model: UserModelSummary | null): void => {
    setEditing(model)
    setDraft(editableModel(model ?? undefined))
    setError(null)
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      setModels(await window.api.models.save(draft, editing?.id))
      await loadSettings()
      setEditing(undefined)
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (model: UserModelSummary): Promise<void> => {
    if (!window.confirm(t('models.deleteConfirm', { name: model.name }))) return
    try {
      setModels(await window.api.models.delete(model.id))
      await loadSettings()
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value))
    }
  }

  return (
    <div className="space-y-10">
      <SettingsSection
        title={t('models.section.title')}
        description={t('models.section.description')}
        action={
          <SettingsButton variant="primary" onClick={() => openEditor(null)}>
            <Plus className="size-3.5" />
            {t('models.add')}
          </SettingsButton>
        }
      >
        <SettingsCard>
          {models.length === 0 ? (
            <div className="flex min-h-40 flex-col items-center justify-center px-8 text-center">
              <KeyRound className="mb-3 size-5 text-muted-foreground" strokeWidth={1.7} />
              <p className="text-[13px] font-medium text-foreground">{t('models.empty.title')}</p>
              <p className="mt-1 max-w-sm text-[12.5px] leading-5 text-muted-foreground">
                {t('models.empty.description')}
              </p>
            </div>
          ) : (
            models.map((model) => {
              const selected = model.id === selectedModelId
              return (
                <div
                  key={model.id}
                  className="flex min-h-[76px] items-center gap-4 border-b border-border/55 px-3.5 py-3 last:border-b-0"
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => void updateModel(model.id)}
                  >
                    <span className="flex items-center gap-2 text-[13px] font-medium text-foreground">
                      {model.name}
                      {selected ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-foreground/6 px-2 py-0.5 text-[11px] font-normal text-muted-foreground">
                          <Check className="size-3" /> {t('models.default')}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-1 block truncate text-[12px] text-muted-foreground">
                      {model.id} · {t(`models.api.${model.api}`)} · {model.baseUrl}
                    </span>
                  </button>
                  {model.source === 'custom' ? (
                    <div className="flex gap-1">
                      <SettingsButton
                        className="px-2"
                        onClick={() => openEditor(model)}
                        aria-label={t('models.edit')}
                      >
                        <Pencil className="size-3.5" />
                      </SettingsButton>
                      <SettingsButton
                        className="px-2"
                        variant="danger"
                        onClick={() => void remove(model)}
                        aria-label={t('models.delete')}
                      >
                        <Trash2 className="size-3.5" />
                      </SettingsButton>
                    </div>
                  ) : (
                    <span className="rounded-full bg-foreground/6 px-2 py-1 text-[11px] text-muted-foreground">
                      {t('models.subscriptions.managed')}
                    </span>
                  )}
                </div>
              )
            })
          )}
        </SettingsCard>
        {error && editing === undefined ? (
          <p className="mt-3 text-[12.5px] text-destructive">{error}</p>
        ) : null}
      </SettingsSection>

      <SubscriptionPlansSection onModelsChanged={handleOAuthModelsChanged} />

      <ImageGenerationModelSection key={refreshVersion} />

      {editing !== undefined ? (
        <SettingsDialog
          title={editing ? t('models.dialog.editTitle') : t('models.dialog.addTitle')}
          description={t('models.dialog.description')}
          closeLabel={t('models.cancel')}
          onClose={() => setEditing(undefined)}
          actions={
            <>
              <SettingsDialogCancel onClick={() => setEditing(undefined)}>
                {t('models.cancel')}
              </SettingsDialogCancel>
              <SettingsButton variant="primary" disabled={saving} onClick={() => void save()}>
                {saving ? t('models.saving') : t('models.save')}
              </SettingsButton>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <label htmlFor="model-name" className="col-span-2 text-[12.5px] text-muted-foreground">
              {t('models.name')}
              <SettingsTextInput
                id="model-name"
                className="mt-1 w-full"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>
            <label htmlFor="model-id" className="col-span-2 text-[12.5px] text-muted-foreground">
              {t('models.id')}
              <SettingsTextInput
                id="model-id"
                className="mt-1 w-full font-mono"
                value={draft.id}
                onChange={(event) => setDraft({ ...draft, id: event.target.value })}
              />
            </label>
            <label htmlFor="model-api" className="col-span-2 text-[12.5px] text-muted-foreground">
              {t('models.api')}
              <SettingsSelect<ModelApiSpec>
                id="model-api"
                className="mt-1 w-full"
                value={draft.api}
                onChange={(api) => setDraft({ ...draft, api })}
                options={MODEL_API_SPECS.filter((api) => api !== 'openai-codex-responses').map(
                  (api) => ({
                    value: api,
                    label: t(`models.api.${api}`)
                  })
                )}
              />
            </label>
            <label
              htmlFor="model-base-url"
              className="col-span-2 text-[12.5px] text-muted-foreground"
            >
              {t('models.baseUrl')}
              <SettingsTextInput
                id="model-base-url"
                className="mt-1 w-full font-mono"
                placeholder="https://api.example.com/v1"
                value={draft.baseUrl}
                onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
              />
            </label>
            <label
              htmlFor="model-api-key"
              className="col-span-2 text-[12.5px] text-muted-foreground"
            >
              {t('models.apiKey')}
              <SettingsTextInput
                id="model-api-key"
                className="mt-1 w-full font-mono"
                type="password"
                placeholder={editing?.hasApiKey ? t('models.apiKeyKeep') : ''}
                value={draft.apiKey}
                onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
              />
            </label>
            <label htmlFor="model-context-window" className="text-[12.5px] text-muted-foreground">
              {t('models.contextWindow')}
              <SettingsTextInput
                id="model-context-window"
                className="mt-1 w-full"
                type="number"
                min={1}
                value={draft.contextWindow}
                onChange={(event) =>
                  setDraft({ ...draft, contextWindow: Number(event.target.value) })
                }
              />
            </label>
            <label htmlFor="model-max-tokens" className="text-[12.5px] text-muted-foreground">
              {t('models.maxTokens')}
              <SettingsTextInput
                id="model-max-tokens"
                className="mt-1 w-full"
                type="number"
                min={1}
                value={draft.maxTokens}
                onChange={(event) => setDraft({ ...draft, maxTokens: Number(event.target.value) })}
              />
            </label>
            <div className="col-span-2 flex items-center justify-between rounded-lg bg-foreground/3 px-3 py-2.5 text-[12.5px] text-foreground">
              {t('models.reasoning')}
              <SettingsSwitch
                checked={draft.reasoning}
                onClick={() => setDraft({ ...draft, reasoning: !draft.reasoning })}
              />
            </div>
            <div className="col-span-2 flex items-center justify-between rounded-lg bg-foreground/3 px-3 py-2.5 text-[12.5px] text-foreground">
              {t('models.images')}
              <SettingsSwitch
                checked={draft.supportsImages}
                onClick={() => setDraft({ ...draft, supportsImages: !draft.supportsImages })}
              />
            </div>
            {error ? <p className="col-span-2 text-[12.5px] text-destructive">{error}</p> : null}
          </div>
        </SettingsDialog>
      ) : null}
    </div>
  )
}
