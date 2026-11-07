import { Button } from '@renderer/components/ui/button'
import { ExternalLink, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  GITHUB_APP_INSTALL_URL,
  GITHUB_TOKEN_URL,
  type GitHubAccount,
  type GitHubAuthMethod,
  type GitHubSignInFailure,
  gitHubTokenSchema
} from '../../../shared/github'
import { useCodexStore } from './store'

const METHODS: GitHubAuthMethod[] = ['app', 'gh-cli', 'token']
const connectedBy = (account: GitHubAccount, method: GitHubAuthMethod) =>
  account.status === 'signed-in' && account.method === method

function Connected({ login }: { login: string }) {
  const { t } = useTranslation()
  const signOut = useCodexStore((s) => s.gitHubSignOut)
  return (
    <div className="github-connected">
      <i className="router-dot" aria-hidden />
      <span>{t('github.signedInAs', { login })}</span>
      <Button size="sm" variant="outline" onClick={() => void signOut()}>
        {t('github.signOut')}
      </Button>
    </div>
  )
}

function failureMethod(failure: GitHubSignInFailure): GitHubAuthMethod {
  if (failure === 'gh-unavailable') return 'gh-cli'
  return failure === 'invalid-token' ? 'token' : 'app'
}

function SignInFailure({ account, method }: { account: GitHubAccount; method: GitHubAuthMethod }) {
  const { t } = useTranslation()
  if (account.status === 'pending' || !account.failure) return null
  if (failureMethod(account.failure) !== method) return null
  return (
    <p className="github-method-error" role="alert">
      {t(`github.signIn.${account.failure}`)}
    </p>
  )
}

function InstallLink() {
  const { t } = useTranslation()
  return (
    <a
      className="github-install-link"
      href={GITHUB_APP_INSTALL_URL}
      target="_blank"
      rel="noreferrer"
    >
      {t('github.install')}
    </a>
  )
}

function DeviceCode({ account }: { account: Extract<GitHubAccount, { status: 'pending' }> }) {
  const { t } = useTranslation()
  const cancelSignIn = useCodexStore((s) => s.gitHubCancelSignIn)
  function openGitHub() {
    // The code is on screen as well, so a blocked clipboard costs one more step, not the sign-in.
    void navigator.clipboard.writeText(account.userCode).catch(() => {})
    window.open(account.verificationUri, '_blank')
  }
  return (
    <>
      <p>{t('github.pendingHelp')}</p>
      <div className="github-device">
        <code>{account.userCode}</code>
        <Loader2 size={15} className="animate-spin" aria-label={t('github.waiting')} />
        <Button size="sm" onClick={openGitHub}>
          {t('github.copyAndOpen')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void cancelSignIn()}>
          {t('github.cancel')}
        </Button>
      </div>
    </>
  )
}

function AppMethod({ account }: { account: GitHubAccount }) {
  const { t } = useTranslation()
  const signIn = useCodexStore((s) => s.gitHubSignIn)
  if (account.status === 'pending') return <DeviceCode account={account} />
  return (
    <>
      <p>{t('github.method.app.help')}</p>
      <div className="github-method-actions">
        {connectedBy(account, 'app') ? null : (
          <Button size="sm" onClick={() => void signIn()}>
            {t('github.connect')}
          </Button>
        )}
        <InstallLink />
      </div>
    </>
  )
}

function CliMethod({ account }: { account: GitHubAccount }) {
  const { t } = useTranslation()
  const connect = useCodexStore((s) => s.gitHubConnectCli)
  const [connecting, setConnecting] = useState(false)
  async function connectCli() {
    setConnecting(true)
    await connect()
    setConnecting(false)
  }
  return (
    <>
      <p>{t('github.method.gh-cli.help')}</p>
      {connectedBy(account, 'gh-cli') ? null : (
        <div className="github-method-actions">
          <Button size="sm" disabled={connecting} onClick={() => void connectCli()}>
            {connecting ? <Loader2 size={14} className="animate-spin" /> : null}
            {t('github.useCli')}
          </Button>
        </div>
      )}
    </>
  )
}

function TokenMethod({ account }: { account: GitHubAccount }) {
  const { t } = useTranslation()
  const connect = useCodexStore((s) => s.gitHubConnectToken)
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)
  const valid = gitHubTokenSchema.safeParse(token)
  async function save() {
    if (!valid.success) return
    setSaving(true)
    await connect(valid.data)
    setSaving(false)
    setToken('')
  }
  return (
    <>
      <p>{t('github.method.token.help')}</p>
      {connectedBy(account, 'token') ? null : (
        <div className="github-method-actions">
          <input
            className="router-input"
            type="password"
            autoComplete="off"
            aria-label={t('github.tokenLabel')}
            placeholder={t('github.tokenPlaceholder')}
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
          <Button size="sm" disabled={!valid.success || saving} onClick={() => void save()}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            {t('github.saveToken')}
          </Button>
          <a
            className="github-install-link"
            href={GITHUB_TOKEN_URL}
            target="_blank"
            rel="noreferrer"
          >
            {t('github.createToken')} <ExternalLink size={11} aria-hidden className="inline" />
          </a>
        </div>
      )}
    </>
  )
}

const METHOD_BODIES = { app: AppMethod, 'gh-cli': CliMethod, token: TokenMethod }

export function GitHubSettingsPane() {
  const { t } = useTranslation()
  const account = useCodexStore((s) => s.github)
  const active = account.status === 'signed-in' ? account.method : null
  const [selected, setSelected] = useState<GitHubAuthMethod>(active ?? 'app')
  useEffect(() => {
    if (active) setSelected(active)
  }, [active])
  return (
    <section className="codex-settings-section">
      <h2>{t('github.title')}</h2>
      <p>{t('github.body')}</p>
      <div className="github-methods" role="radiogroup" aria-label={t('github.methods')}>
        {METHODS.map((method) => {
          const Body = METHOD_BODIES[method]
          return (
            <div className="github-method" key={method}>
              <label>
                <input
                  type="radio"
                  name="github-method"
                  checked={selected === method}
                  onChange={() => setSelected(method)}
                />
                <span>{t(`github.method.${method}`)}</span>
                {method === 'app' ? <small>{t('github.recommended')}</small> : null}
              </label>
              {selected === method ? (
                <div className="github-method-body">
                  {account.status === 'signed-in' && connectedBy(account, method) ? (
                    <Connected login={account.login} />
                  ) : null}
                  <Body account={account} />
                  <SignInFailure account={account} method={method} />
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}
