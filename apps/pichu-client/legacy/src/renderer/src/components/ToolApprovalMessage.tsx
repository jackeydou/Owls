import { ApprovalJsonRender } from '@renderer/components/approval/ApprovalJsonRender'
import { Button } from '@renderer/components/ui/button'
import { useI18n } from '@renderer/lib/i18n'
import { useToolApprovalStore } from '@renderer/stores/tool-approval-store'
import { CornerDownLeft, Pencil } from 'lucide-react'
import { useEffect, useState } from 'react'
import type {
  ToolApprovalAutoReviewEvent,
  ToolApprovalRequestForRenderer,
  ToolApprovalSubject
} from '../../../shared/tool-approval'

function autoReviewReasonKey(autoReview: ToolApprovalAutoReviewEvent) {
  if (autoReview.status === 'timedOut') return 'approval.autoReviewTimedOut'
  if (autoReview.status === 'aborted') return 'approval.autoReviewStopped'
  if (
    autoReview.status === 'denied' &&
    (autoReview.riskLevel === 'high' || autoReview.riskLevel === 'critical')
  ) {
    return 'approval.autoReviewDeniedHighRisk'
  }
  return 'approval.autoReviewReason'
}

function autoReviewMessage(autoReview: ToolApprovalAutoReviewEvent, t: Translation): string | null {
  const rationale = autoReview.rationale?.trim()
  if (!rationale) return null
  if (rationale === 'Auto-review returned an unreadable response.') {
    return t('approval.autoReviewUnreadable')
  }
  return t(autoReviewReasonKey(autoReview), { reason: rationale })
}

type Translation = ReturnType<typeof useI18n>['t']

type ApprovalDisplay = {
  question: string
  body?: string
  detail?: string
  technicalDetails?: string
  technicalDetailsLabel?: string
}

type ApprovalChoice = 'allow' | 'allowRemember' | 'deny'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function readToolCommand(toolInput: unknown): string | undefined {
  if (!isRecord(toolInput)) return undefined
  const command = toolInput.command
  return typeof command === 'string' && command.trim() ? command : undefined
}

function normalizePathForDisplay(value: string): string {
  return value.replace(/^["']|["']$/g, '').replaceAll('$HOME', '~')
}

function readShellAssignment(command: string, name: string): string | undefined {
  const match = command.match(new RegExp(`(?:^|\\n)${name}=(["'])(.*?)\\1`))
  return match?.[2] ? normalizePathForDisplay(match[2]) : undefined
}

function rmTargets(request: ToolApprovalRequestForRenderer): string[] {
  if (request.parsedCommand?.executable !== 'rm') return []
  return request.parsedCommand.arguments
    .filter((argument) => argument === '--' || !argument.startsWith('-'))
    .filter((argument) => argument !== '--')
    .map(normalizePathForDisplay)
}

function trashMoveTarget(command: string): string | undefined {
  const target = readShellAssignment(command, 'TARGET')
  const trash = readShellAssignment(command, 'TRASH')
  if (!target || !trash) return undefined
  if (!/^\s*mv\s+"?\$TARGET"?\s+"?\$DEST"?/m.test(command)) return undefined
  if (!command.includes('$TRASH/') && !command.includes('$HOME/.Trash')) return undefined
  return target
}

function describeApprovalSubject(
  subject: ToolApprovalSubject,
  request: ToolApprovalRequestForRenderer,
  t: Translation
): ApprovalDisplay {
  if (subject.kind === 'privateAccountData') {
    return {
      question: subject.service
        ? t('approval.privateAccountDataQuestionWithService', { service: subject.service })
        : t('approval.privateAccountDataQuestion'),
      body: subject.usesLocalCredentials
        ? t('approval.privateAccountDataCredentialBody')
        : t('approval.privateAccountDataBody'),
      technicalDetails: subject.technicalDetails,
      technicalDetailsLabel: t('approval.technicalDetails')
    }
  }
  if (subject.kind === 'localCredentials') {
    return {
      question: t('approval.localCredentialsQuestion'),
      body: t('approval.localCredentialsBody'),
      technicalDetails: subject.technicalDetails,
      technicalDetailsLabel: t('approval.technicalDetails')
    }
  }
  if (subject.kind === 'networkAccess') {
    return {
      question: subject.target
        ? t('approval.networkAccessQuestionWithTarget', { target: subject.target })
        : t('approval.networkAccessQuestion'),
      body: t('approval.networkAccessBody'),
      technicalDetails: subject.technicalDetails,
      technicalDetailsLabel: t('approval.technicalDetails')
    }
  }
  if (subject.kind === 'fileChange') {
    if (subject.count === 1 && subject.paths[0]) {
      return {
        question: t('approval.editFileQuestion', { path: subject.paths[0] }),
        detail: request.description
      }
    }
    return {
      question: t('approval.editFilesQuestion', { count: subject.count || subject.paths.length }),
      detail: request.description
    }
  }
  if (subject.kind === 'imageGeneration') {
    return {
      question: t('approval.imageGenerationQuestion'),
      detail: request.description
    }
  }
  return {
    question: request.approvalReason?.trim() || t('approval.shellCommandQuestion'),
    detail: subject.technicalDetails ?? subject.command ?? request.description
  }
}

function deriveApprovalDisplay(
  request: ToolApprovalRequestForRenderer,
  t: Translation
): ApprovalDisplay {
  if (request.approvalSubject) {
    return describeApprovalSubject(request.approvalSubject, request, t)
  }

  const command = readToolCommand(request.toolInput)
  if (request.toolName === 'exec_command' && command) {
    const moveTarget = trashMoveTarget(command)
    if (moveTarget) {
      return {
        question: t('approval.moveToTrashQuestion', { target: moveTarget }),
        detail: command
      }
    }

    const targets = rmTargets(request)
    if (targets.length === 1) {
      return {
        question: t('approval.moveToTrashQuestion', { target: targets[0] }),
        detail: command
      }
    }
    if (targets.length > 1) {
      return {
        question: t('approval.moveItemsToTrashQuestion', { count: targets.length }),
        detail: command
      }
    }

    return {
      question: request.approvalReason?.trim() || t('approval.shellCommandQuestion'),
      detail: command
    }
  }

  return {
    question: request.approvalReason?.trim() || t('approval.defaultQuestion'),
    detail: request.description
  }
}

function canRememberApproval(request: ToolApprovalRequestForRenderer): boolean {
  return (
    Boolean(request.rememberRule) &&
    request.approvalSubject?.kind !== 'privateAccountData' &&
    request.approvalSubject?.kind !== 'localCredentials'
  )
}

export function ToolApprovalMessage({
  sessionId
}: {
  sessionId: string | null
}): React.JSX.Element | null {
  const { t } = useI18n()
  const requests = useToolApprovalStore((state) => state.requests)
  const autoReviews = useToolApprovalStore((state) => state.autoReviews)
  const error = useToolApprovalStore((state) => state.error)
  const resolve = useToolApprovalStore((state) => state.resolve)
  const sessionRequests = sessionId ? requests.filter((item) => item.sessionId === sessionId) : []
  const request = sessionRequests[0]
  const requestId = request?.id
  const autoReview = request ? autoReviews[request.id] : undefined
  const [selectedChoice, setSelectedChoice] = useState<ApprovalChoice>('allow')
  const [denyReason, setDenyReason] = useState('')

  useEffect(() => {
    if (!requestId) return
    setSelectedChoice('allow')
    setDenyReason('')
  }, [requestId])

  if (!request) return null
  const display = deriveApprovalDisplay(request, t)
  const trimmedDenyReason = denyReason.trim()
  const autoReviewNotice = autoReview ? autoReviewMessage(autoReview, t) : null
  const showRememberOption = canRememberApproval(request)

  function submitApproval() {
    if (selectedChoice === 'allow') {
      void resolve(request.id, 'allow')
      return
    }
    if (selectedChoice === 'allowRemember' && request.rememberRule) {
      void resolve(request.id, 'allow', undefined, { rememberRule: true })
      return
    }
    void resolve(request.id, 'deny', trimmedDenyReason || undefined)
  }

  function skipApproval() {
    void resolve(request.id, 'deny')
  }

  return (
    <div className="w-full">
      <form
        className="w-full rounded-3xl bg-card/95 px-3.5 pt-3 pb-2.5 text-foreground shadow-(--pichu-composer-shadow) ring ring-black/[0.07] backdrop-blur-lg dark:bg-codex-gray-750"
        role="dialog"
        aria-label={t('approval.dialogLabel')}
        onSubmit={(event) => {
          event.preventDefault()
          submitApproval()
        }}
      >
        <div className="min-w-0">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <h2 className="min-w-0 break-words text-[15px] font-semibold leading-5 text-foreground">
              {display.question}
            </h2>
            {sessionRequests.length > 1 ? (
              <span className="mt-0.5 shrink-0 rounded-md bg-foreground/6 px-1.5 py-0.5 text-[11px] leading-4 text-muted-foreground">
                {t('approval.pendingCount', { count: sessionRequests.length })}
              </span>
            ) : null}
          </div>
          {display.body ? (
            <p className="mt-2 break-words px-1.5 text-[13px] leading-5 text-muted-foreground">
              {display.body}
            </p>
          ) : null}
          {display.detail ? (
            <pre className="mt-2.5 max-h-24 overflow-auto whitespace-pre-wrap break-words px-1.5 font-mono text-[12.5px] leading-5 text-muted-foreground">
              {display.detail}
            </pre>
          ) : null}
          {display.technicalDetails ? (
            <details className="mt-2 px-1.5 text-[12px] leading-5 text-muted-foreground">
              <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">
                {display.technicalDetailsLabel ?? t('approval.technicalDetails')}
              </summary>
              <pre className="mt-1.5 max-h-24 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-5">
                {display.technicalDetails}
              </pre>
            </details>
          ) : null}
          {display.detail && request.description !== display.detail ? (
            <p className="mt-2 line-clamp-2 break-words px-2 text-[12px] leading-5 text-muted-foreground">
              {request.description}
            </p>
          ) : null}
          {request.approvalUi?.renderer === 'json-render' ? (
            <div className="mt-3">
              <ApprovalJsonRender
                spec={request.approvalUi.spec}
                state={request.approvalUi.state}
                toolName={request.toolName}
                cwd={request.cwd}
                toolInput={request.toolInput}
                parsedCommand={request.parsedCommand}
              />
            </div>
          ) : null}
          {autoReviewNotice ? (
            <p className="mt-3 px-2 text-[12px] leading-4 text-muted-foreground">
              {autoReviewNotice}
            </p>
          ) : null}
          {error ? (
            <p className="mt-3 px-2 text-[12px] leading-4 text-destructive">{error}</p>
          ) : null}
        </div>

        <div className="mt-2.5 flex flex-col gap-0.5">
          <button
            type="button"
            className={`group flex min-h-10 w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-[14px] leading-5 transition-colors ${
              selectedChoice === 'allow'
                ? 'bg-foreground/6 text-foreground'
                : 'text-foreground hover:bg-foreground/[0.035]'
            }`}
            onClick={() => setSelectedChoice('allow')}
            aria-pressed={selectedChoice === 'allow'}
          >
            <span
              className={`flex size-5 shrink-0 items-center justify-center rounded-full border text-[12px] leading-none ${
                selectedChoice === 'allow'
                  ? 'border-transparent bg-foreground text-background'
                  : 'border-border bg-card text-muted-foreground'
              }`}
              aria-hidden="true"
            >
              1
            </span>
            <span className="min-w-0 flex-1 font-medium">{t('approval.optionAllowOnce')}</span>
          </button>

          {showRememberOption && request.rememberRule ? (
            <button
              type="button"
              className={`group flex min-h-10 w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-[14px] leading-5 transition-colors ${
                selectedChoice === 'allowRemember'
                  ? 'bg-foreground/6 text-foreground'
                  : 'text-foreground hover:bg-foreground/[0.035]'
              }`}
              onClick={() => setSelectedChoice('allowRemember')}
              aria-pressed={selectedChoice === 'allowRemember'}
            >
              <span
                className={`flex size-5 shrink-0 items-center justify-center rounded-full border text-[12px] leading-none ${
                  selectedChoice === 'allowRemember'
                    ? 'border-transparent bg-foreground text-background'
                    : 'border-border bg-card text-muted-foreground'
                }`}
                aria-hidden="true"
              >
                2
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">
                {t('approval.optionYesRememberCommandPrefix', {
                  command: request.rememberRule.display
                })}
              </span>
            </button>
          ) : null}

          <div className="flex items-center justify-between gap-3">
            <label
              className={`group flex min-h-8 min-w-0 flex-1 items-start gap-2.5 rounded-xl px-2.5 py-1.5 transition-colors focus-within:ring-1 focus-within:ring-accent/40 ${
                selectedChoice === 'deny' ? 'bg-foreground/6' : 'hover:bg-foreground/[0.035]'
              }`}
              onMouseDown={(event) => {
                if (!(event.target instanceof HTMLTextAreaElement)) {
                  event.preventDefault()
                }
                setSelectedChoice('deny')
              }}
            >
              <span
                className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border ${
                  selectedChoice === 'deny'
                    ? 'border-transparent bg-foreground text-background'
                    : 'border-border bg-card text-muted-foreground'
                }`}
                aria-hidden="true"
              >
                <Pencil className="size-3" strokeWidth={1.8} />
              </span>
              <textarea
                className="min-h-5 min-w-0 flex-1 resize-none border-0 bg-transparent p-0 text-[14px] leading-5 text-foreground outline-none placeholder:text-muted-foreground focus:ring-0"
                placeholder={t('approval.denyFeedbackPlaceholder')}
                rows={1}
                value={denyReason}
                onChange={(event) => setDenyReason(event.target.value)}
                onFocus={() => setSelectedChoice('deny')}
              />
            </label>

            <div className="flex shrink-0 items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 rounded-full px-3 text-sm font-medium text-muted-foreground hover:text-foreground"
                onClick={skipApproval}
              >
                {t('approval.skip')}
              </Button>
              <Button
                type="submit"
                size="sm"
                className="h-8 rounded-full bg-foreground px-3.5 text-sm font-semibold text-background hover:bg-foreground/90"
              >
                {t('approval.submit')}
                <span className="inline-flex size-4.5 items-center justify-center rounded-full bg-background/10">
                  <CornerDownLeft className="size-3" strokeWidth={1.8} />
                </span>
              </Button>
            </div>
          </div>
        </div>
      </form>
    </div>
  )
}
