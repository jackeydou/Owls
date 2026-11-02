import { Button } from '@renderer/components/ui/button'
import { IconButton } from '@renderer/components/ui/icon-button'
import { code } from '@streamdown/code'
import {
  Check,
  ChevronRight,
  Copy,
  FileCode2,
  GitBranch,
  Loader2,
  ShieldCheck,
  Terminal,
  Waypoints
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Streamdown } from 'streamdown'
import type { CodexItem, CodexRequest } from '../../../shared/codex'
import { useCodexStore } from './store'

const plugins = { code }
export function ConversationItem({ item, agent }: { item: CodexItem; agent: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  if (item.kind === 'user') return <div className="codex-user-message">{item.text}</div>
  if (item.kind === 'assistant')
    return (
      <article className="codex-assistant-message">
        <div className="codex-message-label">
          <span className="codex-agent-mark">
            <Terminal size={12} />
          </span>
          {agent}
        </div>
        <div className="codex-markdown">
          <Streamdown plugins={plugins} controls={false} isAnimating={item.status === 'running'}>
            {item.text}
          </Streamdown>
        </div>
        {item.status !== 'running' && item.text ? (
          <div className="codex-message-actions">
            <IconButton
              size="sm"
              label={t(copied ? 'copied' : 'copy')}
              tooltip={t(copied ? 'copied' : 'copy')}
              icon={copied ? <Check size={13} /> : <Copy size={13} />}
              onClick={() => {
                void navigator.clipboard.writeText(item.text).then(() => setCopied(true))
              }}
            />
          </div>
        ) : null}
      </article>
    )
  if (!item.text && !item.detail) return null
  const Icon =
    item.kind === 'command'
      ? Terminal
      : item.kind === 'files'
        ? FileCode2
        : item.kind === 'reasoning'
          ? Waypoints
          : GitBranch
  return (
    <details className={`codex-activity ${item.status}`}>
      <summary>
        <Icon size={14} />
        <span>{t(`item.${item.kind}`)}</span>
        {item.kind === 'command' ? (
          <code>{item.text}</code>
        ) : (
          <span className="codex-activity-preview">{item.text.split('\n')[0]}</span>
        )}
        {item.status === 'running' ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <ChevronRight size={12} />
        )}
      </summary>
      {item.kind !== 'command' ? <div className="codex-activity-content">{item.text}</div> : null}
      {item.detail ? <pre>{item.detail}</pre> : null}
    </details>
  )
}
export function RequestCard({
  request,
  sessionId,
  agent
}: {
  request: CodexRequest
  sessionId: string
  agent: string
}) {
  const { t } = useTranslation()
  const respond = useCodexStore((s) => s.respond)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(false)
  async function submit(decision: 'accept' | 'decline' | 'cancel') {
    setPending(true)
    try {
      await respond({
        sessionId,
        requestId: request.id,
        decision,
        ...(request.kind === 'question'
          ? {
              answers: Object.fromEntries(
                Object.entries(answers).map(([id, answer]) => [id, [answer]])
              )
            }
          : {})
      })
    } finally {
      setPending(false)
    }
  }
  return (
    <form
      className="codex-request"
      onSubmit={(event) => {
        event.preventDefault()
        void submit('accept')
      }}
    >
      <div className="codex-request-title">
        <ShieldCheck size={17} />
        <strong>
          {t(request.kind === 'question' ? 'questionTitle' : 'approvalTitle', { agent })}
        </strong>
      </div>
      {request.title ? <pre>{request.title}</pre> : null}
      {request.detail ? <p>{request.detail}</p> : null}
      {request.questions.map((question) => (
        <fieldset key={question.id}>
          <legend>{question.question}</legend>
          {question.options?.map((option) => (
            <label className="codex-answer-option" key={option.label}>
              <input
                type="radio"
                name={request.id + question.id}
                value={option.label}
                checked={answers[question.id] === option.label}
                onChange={() =>
                  setAnswers((previous) => ({ ...previous, [question.id]: option.label }))
                }
              />
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
            </label>
          ))}
          <input
            className="codex-answer-input"
            aria-label={question.question}
            type={question.isSecret ? 'password' : 'text'}
            autoComplete="off"
            placeholder={t(question.options?.length ? 'otherAnswer' : 'answer')}
            value={answers[question.id] ?? ''}
            onChange={(event) =>
              setAnswers((previous) => ({ ...previous, [question.id]: event.target.value }))
            }
          />
        </fieldset>
      ))}
      <div className="codex-request-actions">
        <Button
          size="sm"
          type="submit"
          disabled={
            pending ||
            request.status === 'answering' ||
            request.questions.some((q) => !answers[q.id]?.trim())
          }
        >
          {pending || request.status === 'answering' ? (
            <Loader2 size={13} className="animate-spin" />
          ) : null}
          {t(
            request.status === 'answering'
              ? 'responsePending'
              : request.kind === 'question'
                ? 'continue'
                : 'approve'
          )}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending || request.status === 'answering'}
          onClick={() => void submit(request.kind === 'question' ? 'cancel' : 'decline')}
        >
          {t(request.kind === 'question' ? 'cancel' : 'decline')}
        </Button>
      </div>
    </form>
  )
}
