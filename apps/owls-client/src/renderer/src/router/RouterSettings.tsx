import { ActionButton } from '@renderer/components/ui/action-button'
import { Button } from '@renderer/components/ui/button'
import { CheckIcon, KeyIcon } from '@renderer/components/ui/icons'
import { Select } from '@renderer/components/ui/select'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { permissionSchema } from '../../../shared/app'
import {
  type OwlsModelSettings,
  owlsModelSchema,
  owlsProviderSchema,
  owlsThinkingSchema,
  routerEngineSchema
} from '../../../shared/router'
import { SettingRow } from '../app/SettingRow'
import { useAppStore } from '../app/store'
import { useRouterStore } from './store'

function draftFrom(model: OwlsModelSettings | null): OwlsModelSettings {
  return model ?? { provider: 'anthropic', model: '', thinking: 'low', baseUrl: null }
}

function useRouterSaver() {
  const settings = useAppStore((s) => s.settings)
  const saveSettings = useAppStore((s) => s.saveSettings)
  return async (router: typeof settings.router) => {
    await saveSettings({ ...settings, router })
  }
}

/** Which engine runs the Router, and its model. */
export function RouterEngineRows() {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const claude = useAppStore((s) => s.claude)
  const codex = useAppStore((s) => s.connection)
  const saveRouter = useRouterSaver()
  return (
    <>
      <SettingRow
        label={t('routerSettings.engine')}
        htmlFor="router-engine"
        description={t(`routerSettings.engineHelp.${settings.router.engine}`)}
      >
        <Select
          id="router-engine"
          value={settings.router.engine}
          onChange={(event) =>
            void saveRouter({
              ...settings.router,
              engine: routerEngineSchema.parse(event.target.value)
            })
          }
        >
          {routerEngineSchema.options.map((engine) => (
            <option value={engine} key={engine}>
              {t(`routerSettings.engine.${engine}`)}
            </option>
          ))}
        </Select>
      </SettingRow>
      {settings.router.engine === 'claude-code' ? (
        <SettingRow
          label={t('routerSettings.claudeModel')}
          htmlFor="router-claude-model"
          description={claude.status === 'ready' ? null : t('routerSettings.claudeDisconnected')}
        >
          <Select
            id="router-claude-model"
            value={settings.router.claudeModel ?? ''}
            onChange={(event) =>
              void saveRouter({ ...settings.router, claudeModel: event.target.value || null })
            }
          >
            <option value="">{t('routerSettings.claudeModel.default')}</option>
            {claude.models
              .filter((m) => !m.isDefault)
              .map((m) => (
                <option value={m.id} key={m.id}>
                  {m.name}
                </option>
              ))}
          </Select>
        </SettingRow>
      ) : null}
      {settings.router.engine === 'codex' ? (
        <SettingRow
          label={t('routerSettings.codexModel')}
          htmlFor="router-codex-model"
          description={codex.status === 'ready' ? null : t('routerSettings.codexDisconnected')}
        >
          <Select
            id="router-codex-model"
            value={settings.router.codexModel ?? ''}
            onChange={(event) =>
              void saveRouter({ ...settings.router, codexModel: event.target.value || null })
            }
          >
            <option value="">{t('routerSettings.codexModel.default')}</option>
            {codex.models.map((m) => (
              <option value={m.id} key={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </SettingRow>
      ) : null}
      {settings.router.engine === 'owls' ? <OwlsModelFields /> : null}
    </>
  )
}

/** How far the Router may let workers go, and whether workers that edit code run side by side. */
export function WorkerLimitRows() {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const saveRouter = useRouterSaver()
  return (
    <>
      <SettingRow
        label={t('routerSettings.maxPermission')}
        htmlFor="router-permission"
        description={t('routerSettings.maxPermissionHelp')}
      >
        <Select
          id="router-permission"
          value={settings.router.maxPermission}
          onChange={(event) =>
            void saveRouter({
              ...settings.router,
              maxPermission: permissionSchema.parse(event.target.value)
            })
          }
        >
          {permissionSchema.options.map((permission) => (
            <option value={permission} key={permission}>
              {t(`permission.${permission}`)}
            </option>
          ))}
        </Select>
      </SettingRow>
      <SettingRow
        label={t('routerSettings.worktrees')}
        htmlFor="router-worktrees"
        description={t('routerSettings.worktreesHelp')}
      >
        <Select
          id="router-worktrees"
          value={settings.router.worktrees ? 'on' : 'off'}
          onChange={(event) =>
            void saveRouter({ ...settings.router, worktrees: event.target.value === 'on' })
          }
        >
          <option value="on">{t('routerSettings.worktrees.on')}</option>
          <option value="off">{t('routerSettings.worktrees.off')}</option>
        </Select>
      </SettingRow>
    </>
  )
}

/**
 * Provider, model, and key for the built-in engine; the model is saved only when valid.
 * `guided` saves both with one button, since a saved model ends the guide.
 */
export function OwlsModelFields({ guided = false }: { guided?: boolean }) {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const saveSettings = useAppStore((s) => s.saveSettings)
  const { providers, loadProviders, setKey, removeKey } = useRouterStore()
  const [draft, setDraft] = useState(() => draftFrom(settings.router.owls))
  const [key, setKeyText] = useState('')
  const [savingKey, setSavingKey] = useState(false)
  useEffect(() => {
    void loadProviders()
  }, [loadProviders])
  useEffect(() => {
    setDraft(draftFrom(settings.router.owls))
  }, [settings.router.owls])
  const provider = providers.find((p) => p.id === draft.provider)
  const custom = draft.provider === 'custom'
  const valid = owlsModelSchema.safeParse({
    ...draft,
    baseUrl: custom ? draft.baseUrl : null
  })
  const unchanged = JSON.stringify(settings.router.owls) === JSON.stringify(valid.data ?? null)
  async function saveRouter(router: typeof settings.router) {
    await saveSettings({ ...settings, router })
  }
  async function saveKey() {
    if (!key.trim()) return
    setSavingKey(true)
    if (await setKey(draft.provider, key.trim())) setKeyText('')
    setSavingKey(false)
  }
  async function finish() {
    if (!valid.success) return
    setSavingKey(true)
    const keyed = !key.trim() || (await setKey(draft.provider, key.trim()))
    if (keyed) await saveRouter({ ...settings.router, owls: valid.data })
    setSavingKey(false)
  }
  const keyMissing = !custom && !provider?.configured && !key.trim()
  return (
    <>
      <SettingRow label={t('routerSettings.provider')} htmlFor="router-provider">
        <Select
          id="router-provider"
          value={draft.provider}
          onChange={(event) =>
            setDraft({
              ...draft,
              provider: owlsProviderSchema.parse(event.target.value),
              model: ''
            })
          }
        >
          {providers.map((p) => (
            <option value={p.id} key={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </SettingRow>
      {custom ? (
        <SettingRow label={t('routerSettings.baseUrl')} htmlFor="router-base-url">
          <input
            id="router-base-url"
            className="router-input"
            value={draft.baseUrl ?? ''}
            placeholder="http://127.0.0.1:11434/v1"
            onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value || null })}
          />
        </SettingRow>
      ) : null}
      <SettingRow label={t('routerSettings.model')} htmlFor="router-model">
        {custom ? (
          <input
            id="router-model"
            className="router-input"
            value={draft.model}
            placeholder={t('routerSettings.modelPlaceholder')}
            onChange={(event) => setDraft({ ...draft, model: event.target.value })}
          />
        ) : (
          <Select
            id="router-model"
            value={draft.model}
            onChange={(event) => setDraft({ ...draft, model: event.target.value })}
          >
            <option value="">{t('routerSettings.chooseModel')}</option>
            {(provider?.models ?? []).map((m) => (
              <option value={m.id} key={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        )}
      </SettingRow>
      <SettingRow label={t('routerSettings.thinking')} htmlFor="router-thinking">
        <Select
          id="router-thinking"
          value={draft.thinking}
          onChange={(event) =>
            setDraft({ ...draft, thinking: owlsThinkingSchema.parse(event.target.value) })
          }
        >
          {owlsThinkingSchema.options.map((level) => (
            <option value={level} key={level}>
              {t(`routerSettings.thinking.${level}`)}
            </option>
          ))}
        </Select>
      </SettingRow>
      {guided ? null : (
        <div className="owls-settings-actions">
          <Button
            size="sm"
            disabled={!valid.success || unchanged}
            onClick={() =>
              valid.success && void saveRouter({ ...settings.router, owls: valid.data })
            }
          >
            <CheckIcon size={16} />
            {t('routerSettings.saveModel')}
          </Button>
        </div>
      )}
      <SettingRow
        label={
          <>
            {t('routerSettings.apiKey')}
            {custom ? <small> · {t('routerSettings.apiKeyOptional')}</small> : null}
          </>
        }
        htmlFor="router-key"
        description={guided ? null : t('routerSettings.keyHelp')}
      >
        <input
          id="router-key"
          className="router-input"
          type="password"
          autoComplete="off"
          value={key}
          placeholder={
            provider?.configured
              ? t('routerSettings.keyConfigured')
              : t('routerSettings.apiKeyPlaceholder')
          }
          onChange={(event) => setKeyText(event.target.value)}
        />
      </SettingRow>
      {guided ? <p className="router-settings-help">{t('routerSettings.keyHelp')}</p> : null}
      {guided ? (
        <div className="owls-settings-actions">
          <Button
            size="sm"
            className="router-guide-continue"
            disabled={!valid.success || keyMissing}
            pending={savingKey}
            onClick={() => void finish()}
          >
            {t('router.guideContinue')}
          </Button>
        </div>
      ) : (
        <div className="owls-settings-actions">
          <Button
            size="sm"
            disabled={!key.trim()}
            pending={savingKey}
            onClick={() => void saveKey()}
          >
            <KeyIcon size={16} />
            {t('routerSettings.saveKey')}
          </Button>
          {provider?.configured ? (
            <ActionButton size="sm" variant="outline" onAction={() => removeKey(draft.provider)}>
              {t('routerSettings.removeKey')}
            </ActionButton>
          ) : null}
        </div>
      )}
    </>
  )
}
