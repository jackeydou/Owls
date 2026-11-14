import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, type ButtonProps } from './button'
import { IconButton, type IconButtonProps } from './icon-button'
import { AlertCircleIcon, CheckIcon } from './icons'
import { type ActionPhase, useAction } from './use-action'

type ActionProps = {
  /** The click's work. Resolve to `'done'` (an `ActionOutcome`) to confirm a verified success. */
  onAction: () => Promise<unknown>
  /** Shown briefly after a `'done'` outcome; the text button keeps its own label otherwise. */
  doneLabel?: string
  /** Shown briefly when `onAction` throws; defaults to "Failed". */
  failedLabel?: string
}

/** Announces the settled result to screen readers; the button itself shows it visually. */
function ResultAnnouncement({
  phase,
  done,
  failed
}: {
  phase: ActionPhase
  done: string
  failed: string
}) {
  return (
    <span className="sr-only" role="status">
      {phase === 'done' ? done : phase === 'failed' ? failed : ''}
    </span>
  )
}

export type ActionButtonProps = Omit<ButtonProps, 'onClick' | 'children'> &
  ActionProps & {
    /** Leading icon at rest; a spinner, check, or alert replaces it while the action runs. */
    icon?: ReactNode
    children: ReactNode
  }

/**
 * A text button for async work. It follows the click-feedback rule in AGENTS.md: pressed state
 * from `Button`, a spinner and disabled state while pending, then a brief success or failure mark.
 */
export function ActionButton({
  onAction,
  doneLabel,
  failedLabel,
  icon,
  children,
  pending = false,
  ...props
}: ActionButtonProps) {
  const { t } = useTranslation()
  const { phase, run } = useAction(onAction)
  const failed = failedLabel ?? t('action.failed')
  return (
    <>
      <Button {...props} pending={pending || phase === 'pending'} onClick={() => void run()}>
        {phase === 'done' ? (
          <CheckIcon size={15} aria-hidden />
        ) : phase === 'failed' ? (
          <AlertCircleIcon size={15} aria-hidden />
        ) : (
          icon
        )}
        {phase === 'done' && doneLabel !== undefined
          ? doneLabel
          : phase === 'failed'
            ? failed
            : children}
      </Button>
      <ResultAnnouncement phase={phase} done={doneLabel ?? t('action.done')} failed={failed} />
    </>
  )
}

export type ActionIconButtonProps = Omit<IconButtonProps, 'onClick'> & ActionProps

/** `IconButton` with the same feedback as `ActionButton`; the glyph swaps in place. */
export function ActionIconButton({
  onAction,
  doneLabel,
  failedLabel,
  icon,
  pending = false,
  ...props
}: ActionIconButtonProps) {
  const { t } = useTranslation()
  const { phase, run } = useAction(onAction)
  return (
    <>
      <IconButton
        {...props}
        pending={pending || phase === 'pending'}
        icon={
          phase === 'done' ? (
            <CheckIcon size={15} />
          ) : phase === 'failed' ? (
            <AlertCircleIcon size={15} />
          ) : (
            icon
          )
        }
        onClick={() => void run()}
      />
      <ResultAnnouncement
        phase={phase}
        done={doneLabel ?? t('action.done')}
        failed={failedLabel ?? t('action.failed')}
      />
    </>
  )
}
