import { ActionButton } from '@renderer/components/ui/action-button'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { IconButton } from '@renderer/components/ui/icon-button'
import {
  AlertCircleIcon,
  CircleCheckIcon,
  DownloadIcon,
  InfoIcon,
  LoaderIcon,
  RefreshIcon,
  RotateCcwIcon,
  ScrollTextIcon,
  XIcon
} from '@renderer/components/ui/icons'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Streamdown } from 'streamdown'
import type { UpdateSnapshot } from '../../../shared/updates'
import { markdownLinkComponents } from '../app/MarkdownLink'
import { useUpdateNoticeStore } from './notice-store'
import { installUpdate } from './update-actions'
import { useUpdateSnapshot } from './use-update-snapshot'
import './updates.css'

type NoticeView =
  | { kind: 'checking' }
  | { kind: 'downloading'; version: string; notes: string }
  | { kind: 'ready'; version: string; notes: string }
  | { kind: 'up-to-date'; version: string }
  | { kind: 'failed'; message: string }
  | { kind: 'unavailable'; message: string }

/**
 * Bottom-right update notice. On its own it appears only for a downloaded update. After the app
 * menu's Check for Updates it follows the whole check: checking, downloading, then the ready
 * update; "up to date" and other plain answers count down and close themselves.
 */
export function UpdateNotice() {
  const { t } = useTranslation()
  const snapshot = useUpdateSnapshot()
  const manual = useUpdateNoticeStore((state) => state.manual)
  const checking = useUpdateNoticeStore((state) => state.checking)
  const dismissedVersion = useUpdateNoticeStore((state) => state.dismissedVersion)
  const [notesOpen, setNotesOpen] = useState(false)
  const view = noticeView(snapshot, manual, checking, dismissedVersion, t)
  if (!view) return null
  const readyVersion = view.kind === 'ready' ? view.version : null
  const close = () => useUpdateNoticeStore.getState().close(readyVersion)
  const notes =
    (view.kind === 'downloading' || view.kind === 'ready') && view.notes.trim() ? view : null
  const notesButton = notes ? (
    <Button
      size="custom"
      variant="unstyled"
      className="owlto-update-notes-link"
      onClick={() => setNotesOpen(true)}
    >
      <ScrollTextIcon size={14} aria-hidden />
      {t('updates.notes.open')}
    </Button>
  ) : null
  const closeButton = (
    <IconButton
      size="custom"
      className="owlto-update-notice-close size-7"
      label={t('updates.popup.dismiss')}
      icon={<XIcon size={15} />}
      onClick={close}
    />
  )
  // Plain answers close on their own; the ring around the close button shows the time left.
  const countdown = view.kind === 'up-to-date' || view.kind === 'unavailable'
  return (
    <>
      <section
        className="owlto-update-popup owl-floating"
        aria-labelledby="owlto-update-popup-title"
        aria-live="polite"
        data-view={view.kind}
      >
        <div className="owlto-update-popup-icon" data-tone={tone(view)} aria-hidden>
          {icon(view)}
        </div>
        <div className="owlto-update-popup-body">
          <h2 id="owlto-update-popup-title">{title(view, t)}</h2>
          <p>{body(view, snapshot, t)}</p>
          {notesButton}
          {view.kind === 'checking' || view.kind === 'downloading' ? (
            <div
              className="owlto-update-progress"
              role="progressbar"
              aria-busy="true"
              aria-labelledby="owlto-update-popup-title"
            >
              <span />
            </div>
          ) : null}
          {view.kind === 'ready' ? (
            <div className="owlto-update-popup-actions">
              <ActionButton
                size="sm"
                icon={<RotateCcwIcon size={15} aria-hidden />}
                onAction={installUpdate}
              >
                {t('updates.popup.update')}
              </ActionButton>
              <Button size="sm" variant="ghost" onClick={close}>
                {t('updates.popup.later')}
              </Button>
            </div>
          ) : view.kind === 'failed' ? (
            <div className="owlto-update-popup-actions">
              <Button size="sm" onClick={() => void useUpdateNoticeStore.getState().check()}>
                <RefreshIcon size={15} aria-hidden />
                {t('updates.notice.retry')}
              </Button>
            </div>
          ) : null}
        </div>
        {countdown ? (
          <CountdownRing key={view.kind} onDone={close}>
            {closeButton}
          </CountdownRing>
        ) : (
          closeButton
        )}
      </section>
      {notesOpen && notes ? (
        <UpdateNotesDialog
          version={notes.version}
          notes={notes.notes}
          onClose={() => setNotesOpen(false)}
        />
      ) : null}
    </>
  )
}

/**
 * A ring that empties around its child, then calls `onDone`. CSS runs the countdown, so hovering
 * or focusing the notice pauses it (see updates.css).
 */
function CountdownRing({ onDone, children }: { onDone: () => void; children: ReactNode }) {
  return (
    <div className="owlto-update-countdown">
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <circle className="owlto-update-countdown-track" cx="16" cy="16" r="14" />
        <circle
          className="owlto-update-countdown-bar"
          cx="16"
          cy="16"
          r="14"
          pathLength={100}
          onAnimationEnd={onDone}
        />
      </svg>
      {children}
    </div>
  )
}

/** The release notes of the version being installed, as published in its update feed. */
export function UpdateNotesDialog({
  version,
  notes,
  onClose
}: {
  version: string
  notes: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  return (
    <Dialog
      onClose={onClose}
      className="owlto-update-notes w-[min(560px,calc(100vw-48px))] p-0"
      aria-labelledby="owlto-update-notes-title"
    >
      <header className="owlto-update-notes-head">
        <h2 id="owlto-update-notes-title">{t('updates.notes.title', { version })}</h2>
        <IconButton
          size="custom"
          className="size-7"
          label={t('updates.notes.close')}
          icon={<XIcon size={15} />}
          onClick={onClose}
        />
      </header>
      <div className="owlto-update-notes-body owlto-markdown">
        <Streamdown controls={false} components={markdownLinkComponents}>
          {notes}
        </Streamdown>
      </div>
    </Dialog>
  )
}

type Translate = ReturnType<typeof useTranslation>['t']

function noticeView(
  snapshot: UpdateSnapshot | null | undefined,
  manual: boolean,
  checking: boolean,
  dismissedVersion: string | null,
  t: Translate
): NoticeView | null {
  const state = snapshot?.state
  if (!manual) {
    if (state?.status !== 'ready' || dismissedVersion === state.version) return null
    return { kind: 'ready', version: state.version, notes: state.notes }
  }
  if (snapshot === null) return { kind: 'unavailable', message: t('updates.loadFailed') }
  if (!state) return { kind: 'checking' }
  switch (state.status) {
    case 'downloading':
    case 'ready':
      // An update already on its way is the answer, however fast it came.
      return { kind: state.status, version: state.version, notes: state.notes }
    case 'unsupported':
      return { kind: 'unavailable', message: t(`updates.unsupported.${state.reason}`) }
    case 'idle':
    case 'checking':
      return { kind: 'checking' }
    case 'up-to-date':
      return checking
        ? { kind: 'checking' }
        : { kind: 'up-to-date', version: snapshot.currentVersion }
    case 'failed':
      return checking
        ? { kind: 'checking' }
        : { kind: 'failed', message: t(`updates.failure.${state.failure}`) }
  }
}

function tone(view: NoticeView): 'busy' | 'good' | 'bad' | 'neutral' {
  switch (view.kind) {
    case 'checking':
    case 'downloading':
      return 'busy'
    case 'up-to-date':
      return 'good'
    case 'failed':
      return 'bad'
    default:
      return 'neutral'
  }
}

function icon(view: NoticeView): ReactNode {
  switch (view.kind) {
    case 'checking':
      return <LoaderIcon size={18} className="animate-spin" />
    case 'downloading':
    case 'ready':
      return <DownloadIcon size={18} />
    case 'up-to-date':
      return <CircleCheckIcon size={18} />
    case 'failed':
      return <AlertCircleIcon size={18} />
    case 'unavailable':
      return <InfoIcon size={18} />
  }
}

function title(view: NoticeView, t: Translate): string {
  switch (view.kind) {
    case 'checking':
      return t('updates.notice.checking')
    case 'downloading':
      return t('updates.notice.downloading')
    case 'ready':
      return t('updates.popup.title')
    case 'up-to-date':
      return t('updates.upToDate')
    case 'failed':
      return t('updates.checkFailed')
    case 'unavailable':
      return t('updates.notice.unavailable')
  }
}

function body(view: NoticeView, snapshot: UpdateSnapshot | null | undefined, t: Translate): string {
  switch (view.kind) {
    case 'checking':
      return snapshot
        ? t('updates.notice.checkingBody', { version: snapshot.currentVersion })
        : t('updates.state.checking')
    case 'downloading':
      return t('updates.state.downloading', { version: view.version })
    case 'ready':
      return t('updates.popup.body', { version: view.version })
    case 'up-to-date':
      return t('updates.notice.upToDateBody', { version: view.version })
    case 'failed':
    case 'unavailable':
      return view.message
  }
}
