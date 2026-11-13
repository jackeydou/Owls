import { Button } from '@renderer/components/ui/button'
import { IconButton } from '@renderer/components/ui/icon-button'
import {
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  FileCodeIcon,
  type IconComponent,
  InfoIcon,
  LoaderIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TerminalIcon,
  WaypointsIcon,
  XIcon
} from '@renderer/components/ui/icons'
import { code } from '@streamdown/code'
import { type ReactNode, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Streamdown, type StreamdownProps } from 'streamdown'
import type { AgentRequest, SessionItem } from '../../../shared/app'
import { markdownLinkComponents } from './MarkdownLink'
import { type AgentSpeaker, OwlAvatar } from './OwlAvatar'
import { useAppStore } from './store'

const plugins = { code }
/** How a caller extends assistant Markdown, such as the Router's worker references. */
export type MarkdownExtension = Pick<
  StreamdownProps,
  'allowedTags' | 'components' | 'literalTagContent'
> & { prepare(text: string): string }
export function ConversationItem({
  item,
  agent,
  speaker,
  markdown,
  actions
}: {
  item: SessionItem
  agent: string
  speaker: AgentSpeaker
  markdown?: MarkdownExtension
  /** More buttons for the finished reply's action row, after Copy. */
  actions?: ReactNode
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const extraComponents = markdown?.components
  const components = useMemo(
    () =>
      extraComponents ? { ...markdownLinkComponents, ...extraComponents } : markdownLinkComponents,
    [extraComponents]
  )
  if (item.kind === 'user') return <div className="owls-user-message">{item.text}</div>
  if (item.kind === 'assistant')
    return (
      <article className="owls-assistant-message">
        <div className="owls-message-label">
          <OwlAvatar speaker={speaker} />
          {agent}
        </div>
        <div className="owls-markdown">
          <Streamdown
            plugins={plugins}
            controls={false}
            isAnimating={item.status === 'running'}
            allowedTags={markdown?.allowedTags}
            components={components}
            literalTagContent={markdown?.literalTagContent}
          >
            {markdown ? markdown.prepare(item.text) : item.text}
          </Streamdown>
        </div>
        {item.status !== 'running' && item.text ? (
          <div className="owls-message-actions">
            <IconButton
              size="sm"
              label={t(copied ? 'copied' : 'copy')}
              tooltip={t(copied ? 'copied' : 'copy')}
              icon={copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
              onClick={() => {
                void navigator.clipboard.writeText(item.text).then(() => setCopied(true))
              }}
            />
            {actions}
          </div>
        ) : null}
      </article>
    )
  if (item.kind === 'worker' || (!item.text && !item.detail)) return null
  return <ActivityItem item={item} />
}
const ACTIVITY_ICONS: Partial<Record<SessionItem['kind'], IconComponent>> = {
  command: TerminalIcon,
  files: FileCodeIcon,
  reasoning: WaypointsIcon,
  plan: ScrollTextIcon,
  tool: SparklesIcon
}
/**
 * A tool call is one quiet line, such as "Ran git status", that opens to show the full
 * command, its output, and whether it succeeded.
 */
function ActivityItem({ item }: { item: SessionItem }) {
  const { t } = useTranslation()
  const Icon = ACTIVITY_ICONS[item.kind] ?? InfoIcon
  const running = item.status === 'running'
  const firstLine = item.text.split('\n')[0]
  const verb = t(`activity.${item.kind}.${running ? 'running' : 'done'}`)
  // Files list every path; the line names the first and counts the rest.
  const paths = item.kind === 'files' ? item.text.split('\n').filter(Boolean) : []
  const preview =
    paths.length > 1
      ? t('activity.morePaths', { path: paths[0], count: paths.length - 1 })
      : firstLine
  return (
    <details className={`owls-activity ${item.status}`}>
      <summary>
        <Icon size={16} />
        <span
          className={running ? 'owls-activity-line owls-activity-shimmer' : 'owls-activity-line'}
        >
          <span>{verb}</span>
          {item.kind === 'command' ? <code>{preview}</code> : <span>{preview}</span>}
        </span>
        <ChevronRightIcon size={14} className="owls-activity-chevron" />
      </summary>
      {item.kind === 'command' ? (
        <div className="owls-activity-body">
          <span className="owls-activity-heading">{t('activity.shell')}</span>
          <pre>
            <span aria-hidden>$ </span>
            {item.text}
          </pre>
          {item.detail ? <pre className="owls-activity-output">{item.detail}</pre> : null}
          {running ? null : (
            <span className={`owls-activity-result ${item.status}`}>
              {item.status === 'failed' ? <XIcon size={14} /> : <CheckIcon size={14} />}
              {t(item.status === 'failed' ? 'activity.failed' : 'activity.succeeded')}
            </span>
          )}
        </div>
      ) : (
        <div className="owls-activity-body">
          {item.text ? <div className="owls-activity-content">{item.text}</div> : null}
          {item.detail ? <pre className="owls-activity-output">{item.detail}</pre> : null}
        </div>
      )}
    </details>
  )
}
export function RequestCard({
  request,
  sessionId,
  agent
}: {
  request: AgentRequest
  sessionId: string
  agent: string
}) {
  const { t } = useTranslation()
  const respond = useAppStore((s) => s.respond)
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
      className="owls-request"
      onSubmit={(event) => {
        event.preventDefault()
        void submit('accept')
      }}
    >
      <div className="owls-request-title">
        <ShieldCheckIcon size={19} />
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
            <label className="owls-answer-option" key={option.label}>
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
            className="owls-answer-input"
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
      <div className="owls-request-actions">
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
            <LoaderIcon size={15} className="animate-spin" />
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
