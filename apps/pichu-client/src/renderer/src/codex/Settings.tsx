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
import { settingsSchema } from '../../../shared/codex'
import { TaskOptions } from './Controls'
import { failureMessage, uiFailure } from './failures'
import { useCodexStore } from './store'

export function CodexSettingsPage() {
  const { t } = useTranslation()
  const { connection, settings, sessions, connect, selectExecutable, saveSettings } =
    useCodexStore()
  const [signingIn, setSigningIn] = useState(false)
  const [loginError, setLoginError] = useState<CodexFailure | null>(null)
  const account = connection.account
  const connected = connection.status === 'ready'
  const busy = connection.status === 'connecting'
  const running = sessions.some((s) => ['running', 'starting', 'waiting'].includes(s.status))
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
          onClick={() => useCodexStore.setState({ view: 'chat' })}
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
          <section className="codex-settings-section">
            <h2>{t('defaults')}</h2>
            <p>{t('defaultsBody')}</p>
            <TaskOptions />
            {!connection.models.length ? (
              <p className="codex-note">{t('accountUnavailable')}</p>
            ) : null}
            <p className="codex-note">
              {t(settings.permission === 'full-access' ? 'fullAccessHelp' : 'permissionHelp')}
            </p>
          </section>
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
          </section>
        </div>
      </div>
    </main>
  )
}
