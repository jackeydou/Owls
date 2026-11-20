import { ActionButton } from '@renderer/components/ui/action-button'
import { Button } from '@renderer/components/ui/button'
import { ExternalLinkIcon, FolderOpenIcon } from '@renderer/components/ui/icons'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentProvider, CodexConnection, Failure } from '../../../shared/app'
import { AgentIcon } from '../router/AgentIcon'
import { useAgentPresence, useDetectAgents, useDetectedPath } from './agent-detection'
import { failureMessage, uiFailure } from './failures'
import { SettingRow } from './SettingRow'
import { SettingsTabs } from './SettingsTabs'
import { useAppStore } from './store'

/**
 * The account row's button carries the connection state: a primary Connect while
 * disconnected, and a red Disconnect once connected.
 */
function ConnectionButton({
  provider,
  status,
  running,
  missing,
  onConnect
}: {
  provider: AgentProvider
  status: CodexConnection['status']
  running: boolean
  /** Its CLI was not found: connecting would only fail, so Browse is the way forward. */
  missing: boolean
  onConnect(): void
}) {
  const { t } = useTranslation()
  const disconnectAgent = useAppStore((s) => s.disconnectAgent)
  if (status === 'ready')
    return (
      <ActionButton
        size="sm"
        variant="danger"
        disabled={running}
        onAction={() => disconnectAgent(provider)}
      >
        {t('agentDisconnect')}
      </ActionButton>
    )
  const busy = status === 'connecting'
  return (
    <Button size="sm" disabled={running || missing} pending={busy} onClick={onConnect}>
      {busy ? t('agentConnecting') : status === 'error' ? t('agentReconnect') : t('agentConnect')}
    </Button>
  )
}

/**
 * What the account and Location rows show before connecting: whether the CLI is on this
 * Mac, and where. Nothing connects until the user presses Connect.
 */
function useDetectedRow(provider: AgentProvider, explicit: string | null, live: string | null) {
  const { t } = useTranslation()
  const presence = useAgentPresence(provider)
  const detected = useDetectedPath(provider)
  const missing = presence === 'missing'
  return {
    missing,
    notConnected: missing ? t('agentNotDetected') : t('notConnected'),
    path: live ?? explicit ?? detected ?? (missing ? t('agentNotDetected') : t('autoDetect'))
  }
}

/** "Plan · Max" under the account, when the agent reports a plan. */
function planText(plan: string | null | undefined, label: string): string | null {
  return plan ? `${label} · ${plan.charAt(0).toUpperCase()}${plan.slice(1)}` : null
}

const AGENT_TABS: AgentProvider[] = ['claude-code', 'codex', 'cursor']
const AGENT_PANES: Record<AgentProvider, () => React.JSX.Element> = {
  'claude-code': ClaudeSettingsPane,
  codex: CodexSettingsPane,
  cursor: CursorSettingsPane
}

/** Every coding agent on one page, one horizontal tab each. */
export function AgentsSettingsPane() {
  const { t } = useTranslation()
  const current = useAppStore((s) => s.settingsAgent)
  const showAgentSettings = useAppStore((s) => s.showAgentSettings)
  const Pane = AGENT_PANES[current]
  useDetectAgents()
  return (
    <section className="owlto-settings-section">
      <h2>{t('agents.title')}</h2>
      <SettingsTabs
        label={t('agents.title')}
        tabs={AGENT_TABS.map((provider) => ({
          id: provider,
          label: t(`agent.${provider}`),
          icon: <AgentIcon provider={provider} />
        }))}
        current={current}
        onSelect={showAgentSettings}
      >
        <Pane />
      </SettingsTabs>
    </section>
  )
}

function ExecutableRow({
  path,
  version,
  disabled,
  onBrowse
}: {
  path: string
  version: string | null
  disabled: boolean
  onBrowse(): void
}) {
  const { t } = useTranslation()
  return (
    <SettingRow
      label={t('agentLocation')}
      detail={
        <>
          <code className="owlto-path">{path}</code>
          {version ? <div className="owlto-version">{version}</div> : null}
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

function ClaudeSettingsPane() {
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
  const ready = claude.status === 'ready'
  const row = useDetectedRow('claude-code', settings.claudeExecutablePath, claude.executablePath)
  return (
    <>
      <SettingRow
        label={
          !ready
            ? row.notConnected
            : account.kind === 'claude'
              ? (account.email ?? t('claudeAccount'))
              : account.kind === 'api-key'
                ? t('apiKey')
                : account.kind === 'external'
                  ? t('external')
                  : t('claudeAccount')
        }
        description={
          ready && account.kind === 'claude' ? planText(account.plan, t('subscription')) : null
        }
      >
        <ConnectionButton
          provider="claude-code"
          status={claude.status}
          running={running}
          missing={row.missing}
          onConnect={() => void connectClaude()}
        />
      </SettingRow>
      {claude.error ? (
        <div role="alert" className="owlto-inline-error">
          {failureMessage(claude.error)}
        </div>
      ) : null}
      <ExecutableRow
        path={row.path}
        version={claude.version}
        disabled={claude.status === 'connecting' || running}
        onBrowse={() => void selectClaudeExecutable()}
      />
      <p className="owlto-note">
        {t('claudeSignInHelp')}{' '}
        <a href="https://code.claude.com/docs/en/setup" target="_blank" rel="noreferrer">
          {t('installLink')} <ExternalLinkIcon size={12} />
        </a>
      </p>
    </>
  )
}

function CursorSettingsPane() {
  const { t } = useTranslation()
  const cursor = useAppStore((s) => s.cursor)
  const settings = useAppStore((s) => s.settings)
  const running = useAppStore((s) =>
    s.sessions.some(
      (session) =>
        session.provider === 'cursor' && ['running', 'starting', 'waiting'].includes(session.status)
    )
  )
  const connectCursor = useAppStore((s) => s.connectCursor)
  const selectCursorExecutable = useAppStore((s) => s.selectCursorExecutable)
  const account = cursor.account
  const ready = cursor.status === 'ready'
  const row = useDetectedRow('cursor', settings.cursorExecutablePath, cursor.executablePath)
  return (
    <>
      <SettingRow
        label={
          !ready
            ? row.notConnected
            : account.kind === 'cursor'
              ? (account.email ?? t('cursorAccount'))
              : account.kind === 'signed-out'
                ? t('signedOut')
                : t('cursorAccount')
        }
        description={t('cursorWorkerOnly')}
      >
        <ConnectionButton
          provider="cursor"
          status={cursor.status}
          running={running}
          missing={row.missing}
          onConnect={() => void connectCursor()}
        />
      </SettingRow>
      {cursor.error ? (
        <div role="alert" className="owlto-inline-error">
          {failureMessage(cursor.error)}
        </div>
      ) : null}
      <ExecutableRow
        path={row.path}
        version={cursor.version}
        disabled={cursor.status === 'connecting' || running}
        onBrowse={() => void selectCursorExecutable()}
      />
      <p className="owlto-note">
        {t('cursorSignInHelp')}{' '}
        <a href="https://cursor.com/cli" target="_blank" rel="noreferrer">
          {t('installLink')} <ExternalLinkIcon size={12} />
        </a>
      </p>
    </>
  )
}

function CodexSettingsPane() {
  const { t } = useTranslation()
  const connection = useAppStore((s) => s.connection)
  const settings = useAppStore((s) => s.settings)
  const connect = useAppStore((s) => s.connect)
  const disconnectAgent = useAppStore((s) => s.disconnectAgent)
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
  const ready = connection.status === 'ready'
  const row = useDetectedRow('codex', settings.executablePath, connection.executablePath)
  useEffect(() => {
    if (account.kind !== 'signed-out') setSigningIn(false)
  }, [account.kind])
  async function signIn() {
    setSigningIn(true)
    setLoginError(null)
    try {
      const result = await window.owlto.signIn()
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
    <>
      <SettingRow
        label={
          !ready
            ? row.notConnected
            : account.kind === 'chatgpt'
              ? (account.email ?? 'ChatGPT')
              : account.kind === 'api-key'
                ? t('apiKey')
                : account.kind === 'external'
                  ? t('external')
                  : t('signedOut')
        }
        description={
          ready && account.kind === 'chatgpt' ? planText(account.plan, t('subscription')) : null
        }
      >
        <div className="owlto-settings-actions">
          {signingIn ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void window.owlto.cancelSignIn().then((result) => {
                  if (!result.ok) setLoginError(result.error)
                  setSigningIn(false)
                })
              }}
            >
              {t('cancelSignIn')}
            </Button>
          ) : null}
          {ready && account.kind === 'signed-out' ? (
            <Button size="sm" pending={signingIn} onClick={() => void signIn()}>
              {signingIn ? t('signingIn') : t('signIn')}
            </Button>
          ) : null}
          {connection.status === 'connecting' ? (
            <ActionButton size="sm" variant="ghost" onAction={() => disconnectAgent('codex')}>
              {t('cancel')}
            </ActionButton>
          ) : null}
          <ConnectionButton
            provider="codex"
            status={connection.status}
            running={running}
            missing={row.missing}
            onConnect={() => void connect()}
          />
        </div>
      </SettingRow>
      {connection.error || loginError ? (
        <div role="alert" className="owlto-inline-error">
          {failureMessage(loginError ?? connection.error)}
        </div>
      ) : null}
      <ExecutableRow
        path={row.path}
        version={connection.version}
        disabled={connection.status === 'connecting' || running}
        onBrowse={() => void selectExecutable()}
      />
      <p className="owlto-note">
        {t('installHelp')}{' '}
        <a href="https://developers.openai.com/codex/cli" target="_blank" rel="noreferrer">
          {t('installLink')} <ExternalLinkIcon size={12} />
        </a>
      </p>
    </>
  )
}
