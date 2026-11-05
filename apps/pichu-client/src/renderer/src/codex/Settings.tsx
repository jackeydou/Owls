import { Button } from '@renderer/components/ui/button'
import { IconButton } from '@renderer/components/ui/icon-button'
import { Select } from '@renderer/components/ui/select'
import {
  ArrowLeft,
  Check,
  ExternalLink,
  FolderOpen,
  Loader2,
  RefreshCw,
  Terminal
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CodexFailure } from '../../../shared/codex'
import { appLogoSchema, settingsSchema } from '../../../shared/codex'
import { RouterSettingsSection } from '../router/RouterSettings'
import { appLogoIcons } from './AppLogo'
import { TaskOptions } from './Controls'
import { failureMessage, uiFailure } from './failures'
import { useCodexStore } from './store'

function ClaudeSection() {
  const { t } = useTranslation()
  const claude = useCodexStore((s) => s.claude)
  const settings = useCodexStore((s) => s.settings)
  const running = useCodexStore((s) =>
    s.sessions.some(
      (session) =>
        session.provider === 'claude-code' &&
        ['running', 'starting', 'waiting'].includes(session.status)
    )
  )
  const connectClaude = useCodexStore((s) => s.connectClaude)
  const selectClaudeExecutable = useCodexStore((s) => s.selectClaudeExecutable)
  const account = claude.account
  const busy = claude.status === 'connecting'
  return (
    <section className="codex-settings-section">
      <div className="codex-section-heading">
        <div>
          <h2>{t('localClaude')}</h2>
          <p>{t('localClaudeBody')}</p>
        </div>
        <span className={`codex-connection ${claude.status}`}>
          <i />
          {t(`connection.${claude.status}`)}
        </span>
      </div>
      <div className="codex-account">
        <div className="codex-account-icon">
          <Terminal size={22} />
        </div>
        <div className="codex-account-info">
          <strong>
            {account.kind === 'claude'
              ? (account.email ?? t('claudeAccount'))
              : account.kind === 'api-key'
                ? t('apiKey')
                : account.kind === 'external'
                  ? t('external')
                  : t('claudeAccountUnknown')}
          </strong>
          <span>
            {account.kind === 'claude' && account.plan
              ? `${t('subscription')} · ${account.plan}`
              : t('nativeRuntime')}
          </span>
        </div>
        {claude.status === 'ready' ? <Check size={18} className="codex-success" /> : null}
      </div>
      <div className="codex-settings-actions">
        <Button size="sm" disabled={busy || running} onClick={() => void connectClaude()}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {busy ? t('connectingClaude') : t('useLocalClaude')}
        </Button>
      </div>
      <p className="codex-note">{t('claudeSignInHelp')}</p>
      <p className="codex-note">{t('claudeAuthPrivacy')}</p>
      {claude.error ? (
        <div role="alert" className="codex-inline-error">
          {failureMessage(claude.error)}
        </div>
      ) : null}
      <div className="codex-setting-row">
        <div>
          <h3>{t('claudeExecutable')}</h3>
          <p>{t('claudeExecutableBody')}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || running}
          onClick={() => void selectClaudeExecutable()}
        >
          <FolderOpen size={14} />
          {t('browse')}
        </Button>
      </div>
      <code className="codex-path">
        {claude.executablePath ?? settings.claudeExecutablePath ?? t('autoDetect')}
      </code>
      {claude.version ? <div className="codex-version">{claude.version}</div> : null}
      <p className="codex-note">
        {t('claudeInstallHelp')}{' '}
        <a href="https://code.claude.com/docs/en/setup" target="_blank" rel="noreferrer">
          {t('installLink')} <ExternalLink size={11} />
        </a>
      </p>
    </section>
  )
}

export function CodexSettingsPage() {
  const { t } = useTranslation()
  const { connection, claude, settings, sessions, connect, selectExecutable, saveSettings } =
    useCodexStore()
  const claudeDefaults = settings.provider === 'claude-code'
  const defaultModels = claudeDefaults ? claude.models : connection.models
  const [signingIn, setSigningIn] = useState(false)
  const [loginError, setLoginError] = useState<CodexFailure | null>(null)
  const account = connection.account
  const connected = connection.status === 'ready'
  const busy = connection.status === 'connecting'
  const running = sessions.some(
    (s) => s.provider === 'codex' && ['running', 'starting', 'waiting'].includes(s.status)
  )
  useEffect(() => {
    if (account.kind !== 'signed-out') setSigningIn(false)
  }, [account.kind])
  async function signIn() {
    setSigningIn(true)
    setLoginError(null)
    try {
      const result = await window.codex.signIn()
      if (!result.ok) {
        setLoginError(result.error)
        setSigningIn(false)
      }
    } catch (error) {
      setLoginError(uiFailure(error))
      setSigningIn(false)
    }
  }
  return (
    <main className="codex-settings-page">
      <header className="codex-topbar">
        <IconButton
          label={t('back')}
          tooltip={t('back')}
          icon={<ArrowLeft size={17} />}
          onClick={() => useCodexStore.getState().leaveSettings()}
        />
        <span>{t('settingsTitle')}</span>
      </header>
      <div className="codex-settings-scroll">
        <div className="codex-settings-content">
          <h1>{t('settingsTitle')}</h1>
          <p className="codex-subtitle">{t('settingsBody')}</p>
          <section className="codex-settings-section">
            <div className="codex-section-heading">
              <div>
                <h2>{t('localCodex')}</h2>
                <p>{t('localCodexBody')}</p>
              </div>
              <span className={`codex-connection ${connection.status}`}>
                <i />
                {t(`connection.${connection.status}`)}
              </span>
            </div>
            <div className="codex-account">
              <div className="codex-account-icon">
                <Terminal size={22} />
              </div>
              <div className="codex-account-info">
                <strong>
                  {account.kind === 'chatgpt'
                    ? (account.email ?? 'ChatGPT')
                    : account.kind === 'api-key'
                      ? t('apiKey')
                      : account.kind === 'external'
                        ? t('external')
                        : t('signedOut')}
                </strong>
                <span>
                  {account.kind === 'chatgpt' && account.plan
                    ? `${t('subscription')} · ${account.plan}`
                    : t('nativeRuntime')}
                </span>
              </div>
              {connected && account.kind !== 'signed-out' ? (
                <Check size={18} className="codex-success" />
              ) : null}
            </div>
            <div className="codex-settings-actions">
              <Button size="sm" disabled={busy || running} onClick={() => void connect()}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                {busy ? t('importing') : t('useLocal')}
              </Button>
              {connected && account.kind === 'signed-out' ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={signingIn}
                  onClick={() => void signIn()}
                >
                  {signingIn ? <Loader2 size={14} className="animate-spin" /> : null}
                  {signingIn ? t('signingIn') : t('signIn')}
                </Button>
              ) : null}
              {signingIn ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    void window.codex.cancelSignIn().then((result) => {
                      if (!result.ok) setLoginError(result.error)
                      setSigningIn(false)
                    })
                  }}
                >
                  {t('cancelSignIn')}
                </Button>
              ) : null}
            </div>
            <p className="codex-note">{t('authPrivacy')}</p>
            {connection.error || loginError ? (
              <div role="alert" className="codex-inline-error">
                {failureMessage(loginError ?? connection.error)}
              </div>
            ) : null}
            <div className="codex-setting-row">
              <div>
                <h3>{t('executable')}</h3>
                <p>{t('executableBody')}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || running}
                onClick={() => void selectExecutable()}
              >
                <FolderOpen size={14} />
                {t('browse')}
              </Button>
            </div>
            <code className="codex-path">
              {connection.executablePath ?? settings.executablePath ?? t('autoDetect')}
            </code>
            {connection.version ? <div className="codex-version">{connection.version}</div> : null}
            <p className="codex-note">
              {t('installHelp')}{' '}
              <a href="https://developers.openai.com/codex/cli" target="_blank" rel="noreferrer">
                {t('installLink')} <ExternalLink size={11} />
              </a>
            </p>
          </section>
          <ClaudeSection />
          <section className="codex-settings-section">
            <h2>{t('defaults')}</h2>
            <p>{t('defaultsBody')}</p>
            <TaskOptions />
            {!defaultModels.length ? (
              <p className="codex-note">
                {t(claudeDefaults ? 'claudeAccountUnavailable' : 'accountUnavailable')}
              </p>
            ) : null}
            <p className="codex-note">
              {t(
                settings.permission === 'full-access'
                  ? claudeDefaults
                    ? 'claudeFullAccessHelp'
                    : 'fullAccessHelp'
                  : claudeDefaults
                    ? 'claudePermissionHelp'
                    : 'permissionHelp'
              )}
            </p>
          </section>
          <RouterSettingsSection />
          <section className="codex-settings-section">
            <h2>{t('appearance')}</h2>
            <div className="codex-setting-row">
              <label htmlFor="codex-theme">{t('theme')}</label>
              <Select
                id="codex-theme"
                value={settings.theme}
                onChange={(event) =>
                  void saveSettings({
                    ...settings,
                    theme: settingsSchema.shape.theme.parse(event.target.value)
                  })
                }
              >
                {settingsSchema.shape.theme.options.map((theme) => (
                  <option value={theme} key={theme}>
                    {t(`theme.${theme}`)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="codex-setting-row">
              <label htmlFor="codex-language">{t('language')}</label>
              <Select
                id="codex-language"
                value={settings.language}
                onChange={(event) =>
                  void saveSettings({
                    ...settings,
                    language: settingsSchema.shape.language.parse(event.target.value)
                  })
                }
              >
                <option value="en">English</option>
                <option value="zh-CN">简体中文</option>
              </Select>
            </div>
            <fieldset className="codex-logo-field">
              <legend>{t('appLogo')}</legend>
              <div className="codex-logo-options">
                {appLogoSchema.options.map((logo) => (
                  <label className="codex-logo-option" key={logo}>
                    <input
                      type="radio"
                      name="codex-app-logo"
                      className="sr-only"
                      checked={settings.appLogo === logo}
                      onChange={() => void saveSettings({ ...settings, appLogo: logo })}
                    />
                    <img src={appLogoIcons[logo]} alt="" />
                    <span>{t(`appLogo.${logo}`)}</span>
                  </label>
                ))}
              </div>
              <p className="codex-note">{t('appLogoHelp')}</p>
            </fieldset>
          </section>
        </div>
      </div>
    </main>
  )
}
