import { Button } from '@renderer/components/ui/button'
import { Select } from '@renderer/components/ui/select'
import { Check, KeyRound, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { permissionSchema } from '../../../shared/codex'
import {
  type OwlsModelSettings,
  owlsModelSchema,
  owlsProviderSchema,
  owlsThinkingSchema,
  routerEngineSchema
} from '../../../shared/router'
import { useCodexStore } from '../codex/store'
import { useRouterStore } from './store'

function draftFrom(model: OwlsModelSettings | null): OwlsModelSettings {
  return model ?? { provider: 'anthropic', model: '', thinking: 'low', baseUrl: null }
}

export function RouterSettingsSection() {
  const { t } = useTranslation()
  const settings = useCodexStore((s) => s.settings)
  const saveSettings = useCodexStore((s) => s.saveSettings)
  const claude = useCodexStore((s) => s.claude)
  const codex = useCodexStore((s) => s.connection)
  async function saveRouter(router: typeof settings.router) {
    await saveSettings({ ...settings, router })
  }
  return (
    <section className="codex-settings-section">
      <h2>{t('routerSettings.title')}</h2>
      <p className="router-settings-body">{t('routerSettings.body')}</p>
      <div className="codex-setting-row">
        <label htmlFor="router-engine">{t('routerSettings.engine')}</label>
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
      </div>
      <p className="router-settings-help">
        {t(`routerSettings.engineHelp.${settings.router.engine}`)}
      </p>
      {settings.router.engine === 'claude-code' ? (
        <>
          <div className="codex-setting-row">
            <label htmlFor="router-claude-model">{t('routerSettings.claudeModel')}</label>
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
          </div>
          {claude.status !== 'ready' ? (
            <p className="router-settings-help">{t('routerSettings.claudeDisconnected')}</p>
          ) : null}
        </>
      ) : null}
      {settings.router.engine === 'codex' ? (
        <>
          <div className="codex-setting-row">
            <label htmlFor="router-codex-model">{t('routerSettings.codexModel')}</label>
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
          </div>
          {codex.status !== 'ready' ? (
            <p className="router-settings-help">{t('routerSettings.codexDisconnected')}</p>
          ) : null}
        </>
      ) : null}
      {settings.router.engine === 'owls' ? <OwlsModelFields /> : null}
      <div className="codex-setting-row">
        <label htmlFor="router-permission">{t('routerSettings.maxPermission')}</label>
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
      </div>
      <div className="codex-setting-row">
        <label htmlFor="router-worktrees">{t('routerSettings.worktrees')}</label>
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
      </div>
      <p className="router-settings-help">{t('routerSettings.worktreesHelp')}</p>
    </section>
  )
}

/**
 * Provider, model, and key for the built-in engine; the model is saved only when valid.
 * `guided` saves both with one button, since a saved model ends the guide.
 */
export function OwlsModelFields({ guided = false }: { guided?: boolean }) {
  const { t } = useTranslation()
  const settings = useCodexStore((s) => s.settings)
  const saveSettings = useCodexStore((s) => s.saveSettings)
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
      <div className="codex-setting-row">
        <label htmlFor="router-provider">{t('routerSettings.provider')}</label>
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
      </div>
      {custom ? (
        <div className="codex-setting-row">
          <label htmlFor="router-base-url">{t('routerSettings.baseUrl')}</label>
          <input
            id="router-base-url"
            className="router-input"
            value={draft.baseUrl ?? ''}
            placeholder="http://127.0.0.1:11434/v1"
            onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value || null })}
          />
        </div>
      ) : null}
      <div className="codex-setting-row">
        <label htmlFor="router-model">{t('routerSettings.model')}</label>
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
      </div>
      <div className="codex-setting-row">
        <label htmlFor="router-thinking">{t('routerSettings.thinking')}</label>
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
      </div>
      {guided ? null : (
        <div className="codex-settings-actions">
          <Button
            size="sm"
            disabled={!valid.success || unchanged}
            onClick={() =>
              valid.success && void saveRouter({ ...settings.router, owls: valid.data })
            }
          >
            <Check size={14} />
            {t('routerSettings.saveModel')}
          </Button>
        </div>
      )}
      <div className="codex-setting-row">
        <label htmlFor="router-key">
          {t('routerSettings.apiKey')}
          {custom ? <small> · {t('routerSettings.apiKeyOptional')}</small> : null}
        </label>
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
      </div>
      <p className="router-settings-help">{t('routerSettings.keyHelp')}</p>
      {guided ? (
        <div className="codex-settings-actions">
          <Button
            size="sm"
            className="router-guide-continue"
            disabled={!valid.success || keyMissing || savingKey}
            onClick={() => void finish()}
          >
            {savingKey ? <Loader2 size={14} className="animate-spin" /> : null}
            {t('router.guideContinue')}
          </Button>
        </div>
      ) : (
        <div className="codex-settings-actions">
          <Button size="sm" disabled={!key.trim() || savingKey} onClick={() => void saveKey()}>
            {savingKey ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
            {t('routerSettings.saveKey')}
          </Button>
          {provider?.configured ? (
            <Button size="sm" variant="outline" onClick={() => void removeKey(draft.provider)}>
              {t('routerSettings.removeKey')}
            </Button>
          ) : null}
        </div>
      )}
    </>
  )
}
