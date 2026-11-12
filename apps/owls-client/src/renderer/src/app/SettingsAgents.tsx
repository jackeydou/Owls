import { Button } from '@renderer/components/ui/button'
import {
  ExternalLinkIcon,
  FolderOpenIcon,
  LoaderIcon,
  RefreshIcon
} from '@renderer/components/ui/icons'
import { type ReactNode, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CodexConnection, Failure } from '../../../shared/app'
import { failureMessage, uiFailure } from './failures'
import { SettingRow } from './SettingRow'
import { useAppStore } from './store'

function AgentPane({
  title,
  body,
  status,
  children
}: {
  title: string
  body: string
  status: CodexConnection['status']
  children: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <section className="owls-settings-section">
      <div className="owls-section-heading">
        <div>
          <h2>{title}</h2>
          <p>{body}</p>
        </div>
        <span className={`owls-connection ${status}`}>
          <i />
          {t(`connection.${status}`)}
        </span>
      </div>
      {children}
    </section>
  )
}

function ExecutableRow({
  label,
  body,
  path,
  version,
  disabled,
  onBrowse
}: {
  label: string
  body: string
  path: string
  version: string | null
  disabled: boolean
  onBrowse(): void
}) {
  const { t } = useTranslation()
  return (
    <SettingRow
      label={label}
      description={body}
      detail={
        <>
          <code className="owls-path">{path}</code>
          {version ? <div className="owls-version">{version}</div> : null}
        </>
      }
    >
      <Button size="sm" variant="outline" disabled={disabled} onClick={onBrowse}>
        <FolderOpenIcon size={16} />
        {t('browse')}
      </Button>
    </SettingRow>
  )
}

export function ClaudeSettingsPane() {
  const { t } = useTranslation()
  const claude = useAppStore((s) => s.claude)
  const settings = useAppStore((s) => s.settings)
  const running = useAppStore((s) =>
    s.sessions.some(
      (session) =>
        session.provider === 'claude-code' &&
        ['running', 'starting', 'waiting'].includes(session.status)
    )
  )
  const connectClaude = useAppStore((s) => s.connectClaude)
  const selectClaudeExecutable = useAppStore((s) => s.selectClaudeExecutable)
  const account = claude.account
  const busy = claude.status === 'connecting'
  return (
    <AgentPane title={t('localClaude')} body={t('localClaudeBody')} status={claude.status}>
      <SettingRow
        label={
          account.kind === 'claude'
            ? (account.email ?? t('claudeAccount'))
            : account.kind === 'api-key'
              ? t('apiKey')
              : account.kind === 'external'
                ? t('external')
                : t('claudeAccountUnknown')
        }
        description={
          account.kind === 'claude' && account.plan
            ? `${t('subscription')} · ${account.plan}`
            : t('nativeRuntime')
        }
      >
        <Button
          size="sm"
          variant={claude.status === 'ready' ? 'outline' : 'default'}
          disabled={busy || running}
          onClick={() => void connectClaude()}
        >
          {busy ? <LoaderIcon size={16} className="animate-spin" /> : <RefreshIcon size={16} />}
          {busy ? t('connectingClaude') : t('useLocalClaude')}
        </Button>
      </SettingRow>
      {claude.error ? (
        <div role="alert" className="owls-inline-error">
          {failureMessage(claude.error)}
        </div>
      ) : null}
      <ExecutableRow
        label={t('claudeExecutable')}
        body={t('claudeExecutableBody')}
        path={claude.executablePath ?? settings.claudeExecutablePath ?? t('autoDetect')}
        version={claude.version}
        disabled={busy || running}
        onBrowse={() => void selectClaudeExecutable()}
      />
      <p className="owls-note">{t('claudeSignInHelp')}</p>
      <p className="owls-note">{t('claudeAuthPrivacy')}</p>
      <p className="owls-note">
        {t('claudeInstallHelp')}{' '}
        <a href="https://code.claude.com/docs/en/setup" target="_blank" rel="noreferrer">
          {t('installLink')} <ExternalLinkIcon size={12} />
        </a>
      </p>
    </AgentPane>
  )
}

export function AgentSettingsPane() {
  const { t } = useTranslation()
  const connection = useAppStore((s) => s.connection)
  const settings = useAppStore((s) => s.settings)
  const connect = useAppStore((s) => s.connect)
  const selectExecutable = useAppStore((s) => s.selectExecutable)
  const running = useAppStore((s) =>
    s.sessions.some(
      (session) =>
        session.provider === 'codex' && ['running', 'starting', 'waiting'].includes(session.status)
    )
  )
  const [signingIn, setSigningIn] = useState(false)
  const [loginError, setLoginError] = useState<Failure | null>(null)
  const account = connection.account
  const connected = connection.status === 'ready'
  const busy = connection.status === 'connecting'
  useEffect(() => {
    if (account.kind !== 'signed-out') setSigningIn(false)
  }, [account.kind])
  async function signIn() {
    setSigningIn(true)
    setLoginError(null)
    try {
      const result = await window.owls.signIn()
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
    <AgentPane title={t('localCodex')} body={t('localCodexBody')} status={connection.status}>
      <SettingRow
        label={
          account.kind === 'chatgpt'
            ? (account.email ?? 'ChatGPT')
            : account.kind === 'api-key'
              ? t('apiKey')
              : account.kind === 'external'
                ? t('external')
                : t('signedOut')
        }
        description={
          account.kind === 'chatgpt' && account.plan
            ? `${t('subscription')} · ${account.plan}`
            : t('nativeRuntime')
        }
      >
        <div className="owls-settings-actions">
          {signingIn ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void window.owls.cancelSignIn().then((result) => {
                  if (!result.ok) setLoginError(result.error)
                  setSigningIn(false)
                })
              }}
            >
              {t('cancelSignIn')}
            </Button>
          ) : null}
          {connected && account.kind === 'signed-out' ? (
            <Button size="sm" variant="outline" disabled={signingIn} onClick={() => void signIn()}>
              {signingIn ? <LoaderIcon size={16} className="animate-spin" /> : null}
              {signingIn ? t('signingIn') : t('signIn')}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant={connected ? 'outline' : 'default'}
            disabled={busy || running}
            onClick={() => void connect()}
          >
            {busy ? <LoaderIcon size={16} className="animate-spin" /> : <RefreshIcon size={16} />}
            {busy ? t('importing') : t('useLocal')}
          </Button>
        </div>
      </SettingRow>
      {connection.error || loginError ? (
        <div role="alert" className="owls-inline-error">
          {failureMessage(loginError ?? connection.error)}
        </div>
      ) : null}
      <ExecutableRow
        label={t('executable')}
        body={t('executableBody')}
        path={connection.executablePath ?? settings.executablePath ?? t('autoDetect')}
        version={connection.version}
        disabled={busy || running}
        onBrowse={() => void selectExecutable()}
      />
      <p className="owls-note">{t('authPrivacy')}</p>
      <p className="owls-note">
        {t('installHelp')}{' '}
        <a href="https://developers.openai.com/codex/cli" target="_blank" rel="noreferrer">
          {t('installLink')} <ExternalLinkIcon size={12} />
        </a>
      </p>
    </AgentPane>
  )
}
