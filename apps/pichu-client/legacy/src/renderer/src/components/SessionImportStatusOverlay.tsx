import { useI18n } from '@renderer/lib/i18n'
import { useSessionStore } from '@renderer/stores/session-store'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { SessionImportDeeplinkStatus } from '../../../shared/session-import-deeplink'
import { Toast, type ToastVariant, ToastViewport } from './ui/toast'

const COMPLETED_STATUS_AUTO_DISMISS_MS = 5000

function SessionImportStatusToast({
  status,
  onClose
}: {
  status: Exclude<SessionImportDeeplinkStatus, { state: 'idle' }>
  onClose: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const isImporting = status.state === 'importing'
  const isCompleted = status.state === 'completed'
  const variant: ToastVariant = isImporting ? 'loading' : isCompleted ? 'success' : 'error'
  const title = isImporting
    ? t('layout.sessionImport.importingTitle')
    : isCompleted
      ? t('layout.sessionImport.completedTitle')
      : t('layout.sessionImport.failedTitle')
  const description = isImporting
    ? t('layout.sessionImport.importingDescription')
    : isCompleted
      ? t('layout.sessionImport.completedDescription')
      : status.message

  return (
    <Toast
      title={title}
      description={description}
      variant={variant}
      onClose={isImporting ? undefined : onClose}
      closeLabel={t('layout.sessionImport.dismiss')}
    />
  )
}

export function SessionImportStatusOverlay(): React.JSX.Element {
  const navigate = useNavigate()
  const [sessionImportStatus, setSessionImportStatus] =
    useState<SessionImportDeeplinkStatus | null>(null)
  const openedImportSessionIdRef = useRef<string | null>(null)

  const clearSessionImportStatus = useCallback(() => {
    setSessionImportStatus(null)
    void window.api.agent.clearSessionImportDeeplinkStatus().catch((error: unknown) => {
      console.error('[session-import] Failed to clear deeplink import status', error)
    })
  }, [])

  useEffect(() => {
    const applyStatus = (status: SessionImportDeeplinkStatus): void => {
      setSessionImportStatus(status.state === 'idle' ? null : status)
    }
    let cancelled = false
    void window.api.agent
      .sessionImportDeeplinkStatus()
      .then((status) => {
        if (!cancelled) {
          applyStatus(status)
        }
      })
      .catch((error: unknown) => {
        console.error('[session-import] Failed to read deeplink import status', error)
      })

    const unsubscribe = window.api.agent.onSessionImportDeeplinkStatus((status) => {
      applyStatus(status)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (sessionImportStatus?.state !== 'completed') {
      return
    }
    if (openedImportSessionIdRef.current !== sessionImportStatus.sessionId) {
      openedImportSessionIdRef.current = sessionImportStatus.sessionId
      void (async () => {
        const store = useSessionStore.getState()
        await store.loadSession(sessionImportStatus.sessionId)
        await store.loadSessionIndex()
        navigate('/')
      })().catch((error: unknown) => {
        console.error('[session-import] Failed to open imported session', error)
      })
    }
    const timeout = window.setTimeout(() => {
      clearSessionImportStatus()
    }, COMPLETED_STATUS_AUTO_DISMISS_MS)
    return () => window.clearTimeout(timeout)
  }, [clearSessionImportStatus, navigate, sessionImportStatus])

  return (
    <ToastViewport>
      {sessionImportStatus && sessionImportStatus.state !== 'idle' ? (
        <SessionImportStatusToast status={sessionImportStatus} onClose={clearSessionImportStatus} />
      ) : null}
    </ToastViewport>
  )
}
