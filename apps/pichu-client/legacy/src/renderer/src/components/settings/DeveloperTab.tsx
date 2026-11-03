import type { PluginAdminCatalogItem } from '@renderer/../../preload/index.d'
import { Toast, type ToastVariant, ToastViewport } from '@renderer/components/ui/toast'
import { useI18n } from '@renderer/lib/i18n'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { DeveloperPluginDetailPage } from './DeveloperPluginDetailPage'
import { DeveloperPluginsListPage } from './DeveloperPluginsListPage'
import type { PluginAdminPendingAction } from './developer-plugin-admin'

function pluginDetailPath(pluginName: string): string {
  return `/settings/developer/plugins/${encodeURIComponent(pluginName)}`
}

function pluginNameFromPath(pathname: string): string | null {
  const prefix = '/settings/developer/plugins/'
  if (!pathname.startsWith(prefix)) return null
  const encoded = pathname.slice(prefix.length).split('/')[0]
  return encoded ? decodeURIComponent(encoded) : null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type DeveloperToastState = {
  id: number
  title: string
  variant: ToastVariant
}

export function DeveloperTab(): React.JSX.Element {
  const { t } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const [plugins, setPlugins] = useState<PluginAdminCatalogItem[]>([])
  const [pendingAction, setPendingAction] = useState<PluginAdminPendingAction>('load')
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<DeveloperToastState | null>(null)
  const [uploadAuthLoginPluginName, setUploadAuthLoginPluginName] = useState<string | null>(null)
  const uploadCancelledRef = useRef(false)
  const selectedPluginName = pluginNameFromPath(location.pathname)

  const refreshPlugins = useCallback(async (): Promise<PluginAdminCatalogItem[]> => {
    const items = await window.api.plugins.adminList()
    setPlugins(items)
    return items
  }, [])

  useEffect(() => {
    let cancelled = false
    setPendingAction('load')
    setError(null)
    void refreshPlugins()
      .catch((loadError) => {
        if (!cancelled) setError(errorMessage(loadError))
      })
      .finally(() => {
        if (!cancelled) setPendingAction(null)
      })
    return () => {
      cancelled = true
    }
  }, [refreshPlugins])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(null), 3600)
    return () => window.clearTimeout(timeout)
  }, [toast])

  useEffect(
    () =>
      window.api.plugins.onEvent((event) => {
        if (event.type === 'admin-auth-login-started') {
          setUploadAuthLoginPluginName(event.pluginName)
        }
      }),
    []
  )

  const selectedPlugin = selectedPluginName
    ? (plugins.find((plugin) => plugin.pluginName === selectedPluginName) ?? null)
    : null

  const showToast = (title: string, variant: ToastVariant = 'success'): void => {
    setToast({ id: Date.now(), title, variant })
  }

  const refresh = async (): Promise<void> => {
    setPendingAction('load')
    setError(null)
    try {
      await refreshPlugins()
    } catch (refreshError) {
      setError(errorMessage(refreshError))
    } finally {
      setPendingAction(null)
    }
  }

  return (
    <div className="space-y-9 pb-10">
      {error ? (
        <div className="rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2 text-[12.5px] leading-5 text-destructive">
          {error}
        </div>
      ) : null}

      {selectedPlugin ? (
        <DeveloperPluginDetailPage
          plugin={selectedPlugin}
          loading={pendingAction === 'load'}
          pendingAction={pendingAction}
          onBack={() => navigate('/settings/developer')}
          onRefresh={refresh}
          authLoginInProgress={uploadAuthLoginPluginName === selectedPlugin.pluginName}
          onCancelUpload={() => {
            uploadCancelledRef.current = true
            setUploadAuthLoginPluginName(null)
            void window.api.plugins
              .adminCancelUpload({ pluginName: selectedPlugin.pluginName })
              .catch(() => {})
          }}
          onUpload={async (filePath) => {
            setPendingAction('upload')
            setError(null)
            uploadCancelledRef.current = false
            setUploadAuthLoginPluginName(null)
            try {
              const result = await window.api.plugins.adminUpload({
                pluginName: selectedPlugin.pluginName,
                filePath,
                category: selectedPlugin.category
              })
              await refreshPlugins()
              showToast(
                t('developer.plugins.upload.localSuccess', {
                  version: result.version,
                  path: 'sourcePath' in result ? result.sourcePath : filePath
                })
              )
            } catch (uploadError) {
              if (uploadCancelledRef.current && /cancel/i.test(errorMessage(uploadError))) return
              setError(errorMessage(uploadError))
              throw uploadError
            } finally {
              setUploadAuthLoginPluginName(null)
              setPendingAction(null)
            }
          }}
        />
      ) : (
        <DeveloperPluginsListPage
          plugins={plugins}
          loading={pendingAction === 'load'}
          onRefresh={refresh}
          onOpenPlugin={(pluginName) => navigate(pluginDetailPath(pluginName))}
        />
      )}

      <ToastViewport>
        {toast ? (
          <Toast
            key={toast.id}
            title={toast.title}
            variant={toast.variant}
            onClose={() => setToast(null)}
            closeLabel={t('developer.plugins.toast.dismiss')}
          />
        ) : null}
      </ToastViewport>
    </div>
  )
}
