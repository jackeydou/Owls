import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { AlertCircleIcon, CircleCheckIcon, ExternalLinkIcon } from '@renderer/components/ui/icons'
import { Switch } from '@renderer/components/ui/switch'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  diagnosticsLine,
  FEEDBACK_BODY_MAX,
  FEEDBACK_REPOSITORY,
  FEEDBACK_TITLE_MAX,
  type FeedbackResult
} from '../../../shared/feedback'
import { useAppStore } from '../app/store'
import { useFeedbackStore } from './store'

type Sent = Exclude<FeedbackResult, { kind: 'failed' }>
const repository = `${FEEDBACK_REPOSITORY.owner}/${FEEDBACK_REPOSITORY.name}`

/** Writes feedback and files it as a GitHub issue; the result replaces the form. */
export function FeedbackDialog() {
  const close = useFeedbackStore((s) => s.close)
  const [sent, setSent] = useState<Sent | null>(null)
  return (
    <Dialog className="owlto-feedback" aria-labelledby="owlto-feedback-title" onClose={close}>
      {sent ? <FeedbackSent result={sent} /> : <FeedbackForm onSent={setSent} />}
    </Dialog>
  )
}

function FeedbackForm({ onSent }: { onSent: (result: Sent) => void }) {
  const { t } = useTranslation()
  const { draft, includeDiagnostics, diagnostics, close, edit, setIncludeDiagnostics, send } =
    useFeedbackStore()
  const github = useAppStore((s) => s.github)
  const showSettings = useAppStore((s) => s.showSettings)
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState(false)
  const signedIn = github.status === 'signed-in'
  const ready = draft.body.trim().length > 0 && !sending
  async function submit() {
    if (!ready) return
    setSending(true)
    setFailed(false)
    const result = await send()
    setSending(false)
    if (result.kind === 'failed') setFailed(true)
    else onSent(result)
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          void submit()
        }
      }}
    >
      <h2 id="owlto-feedback-title">{t('feedback.title')}</h2>
      <p className="owlto-feedback-lead">{t('feedback.lead', { repository })}</p>
      <input
        className="owlto-feedback-field"
        aria-label={t('feedback.subject')}
        placeholder={t('feedback.subjectPlaceholder')}
        maxLength={FEEDBACK_TITLE_MAX}
        value={draft.title}
        onChange={(event) => edit({ title: event.target.value })}
      />
      <textarea
        className="owlto-feedback-field"
        aria-label={t('feedback.body')}
        placeholder={t('feedback.bodyPlaceholder')}
        rows={6}
        maxLength={FEEDBACK_BODY_MAX}
        // biome-ignore lint/a11y/noAutofocus: the dialog opens to write feedback.
        autoFocus
        value={draft.body}
        onChange={(event) => edit({ body: event.target.value })}
      />
      <div className="owlto-feedback-diagnostics">
        <Switch
          id="owlto-feedback-diagnostics"
          checked={includeDiagnostics}
          onCheckedChange={setIncludeDiagnostics}
        />
        <label htmlFor="owlto-feedback-diagnostics">
          <span>{t('feedback.diagnostics')}</span>
          {diagnostics ? <small>{diagnosticsLine(diagnostics)}</small> : null}
        </label>
      </div>
      {failed ? (
        <p className="owlto-feedback-error" role="alert">
          <AlertCircleIcon size={15} aria-hidden />
          {t('feedback.failed')}
        </p>
      ) : null}
      <footer>
        <p className="owlto-feedback-identity">
          {signedIn ? (
            t('feedback.asUser', { login: github.login })
          ) : (
            <>
              {t('feedback.viaBrowser')}{' '}
              <button
                type="button"
                className="owlto-feedback-link"
                onClick={() => {
                  close()
                  showSettings('github')
                }}
              >
                {t('feedback.connect')}
              </button>
            </>
          )}
        </p>
        <Button type="button" size="sm" variant="ghost" onClick={close}>
          {t('feedback.cancel')}
        </Button>
        <Button type="submit" size="sm" pending={sending} disabled={!ready}>
          {signedIn ? t('feedback.send') : t('feedback.continueOnGitHub')}
        </Button>
      </footer>
    </form>
  )
}

function FeedbackSent({ result }: { result: Sent }) {
  const { t } = useTranslation()
  const close = useFeedbackStore((s) => s.close)
  return (
    <div className="owlto-feedback-sent" role="status">
      {result.kind === 'created' ? (
        <>
          <CircleCheckIcon size={28} aria-hidden />
          <h2 id="owlto-feedback-title">{t('feedback.created', { number: result.number })}</h2>
          <p>{t('feedback.createdDetail')}</p>
        </>
      ) : (
        <>
          <ExternalLinkIcon size={28} aria-hidden />
          <h2 id="owlto-feedback-title">{t('feedback.opened')}</h2>
          <p>{t(result.reason === 'no-access' ? 'feedback.noAccess' : 'feedback.openedDetail')}</p>
        </>
      )}
      <footer>
        {result.kind === 'created' ? (
          // The window's open handler sends https links to the default browser.
          <Button size="sm" variant="ghost" onClick={() => window.open(result.url)}>
            <ExternalLinkIcon size={15} aria-hidden />
            {t('feedback.view')}
          </Button>
        ) : null}
        <Button size="sm" onClick={close}>
          {t('feedback.done')}
        </Button>
      </footer>
    </div>
  )
}
