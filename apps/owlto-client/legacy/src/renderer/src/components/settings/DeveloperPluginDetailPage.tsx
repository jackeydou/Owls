import type { PluginAdminCatalogItem, PluginAdminVersion } from '@renderer/../../preload/index.d'
import { useI18n } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { ArrowLeft, RefreshCw, Upload } from 'lucide-react'
import { useState } from 'react'
import { DeveloperPluginUploadDialog } from './DeveloperPluginUploadDialog'
import type { PluginAdminPendingAction } from './developer-plugin-admin'
import {
  formatPluginAdminBytes,
  formatPluginAdminDate,
  pluginAdminTitle
} from './developer-plugin-admin'
import { SettingsButton } from './settings-ui'

export function DeveloperPluginDetailPage({
  plugin,
  loading,
  pendingAction,
  onBack,
  onRefresh,
  authLoginInProgress,
  onCancelUpload,
  onUpload
}: {
  plugin: PluginAdminCatalogItem
  loading: boolean
  pendingAction: PluginAdminPendingAction
  onBack: () => void
  onRefresh: () => Promise<void>
  authLoginInProgress: boolean
  onCancelUpload: () => void
  onUpload: (filePath: string) => Promise<void>
}): React.JSX.Element {
  const { t } = useI18n()
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploading, setUploading] = useState(false)

  return (
    <>
      <div className="space-y-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-7 items-center gap-1 text-[12.5px] font-medium text-muted-foreground transition hover:text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/10"
        >
          <ArrowLeft className="size-3.5" strokeWidth={1.8} />
          {t('developer.plugins.backToList')}
        </button>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-[18px] font-semibold leading-6 text-foreground">
              {pluginAdminTitle(plugin)}
            </h3>
            <p className="mt-0.5 truncate font-mono text-[12px] text-muted-foreground">
              {plugin.pluginName}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <SettingsButton
              disabled={loading}
              aria-label={t('developer.plugins.refresh')}
              onClick={() => void onRefresh()}
              className="size-[34px] px-0"
            >
              <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} strokeWidth={1.8} />
            </SettingsButton>
            <SettingsButton
              variant="primary"
              disabled={loading}
              onClick={() => setUploadOpen(true)}
            >
              <Upload className="size-3.5" strokeWidth={1.8} />
              {t('developer.plugins.upload.open')}
            </SettingsButton>
          </div>
        </div>

        <section className="space-y-2">
          <h4 className="text-[13px] font-medium leading-5 text-foreground">
            {t('developer.plugins.versions.title')}
          </h4>
          {plugin.versions.length === 0 ? (
            <div className="border-y border-border/55 py-8 text-center text-[13px] text-muted-foreground">
              {t('developer.plugins.versions.empty')}
            </div>
          ) : (
            <div className="divide-y divide-border/55 border-y border-border/55">
              {plugin.versions.map((version) => (
                <LocalVersionRow key={version.id} version={version} />
              ))}
            </div>
          )}
        </section>
      </div>

      <DeveloperPluginUploadDialog
        open={uploadOpen}
        busy={uploading || pendingAction === 'upload'}
        authLoginInProgress={authLoginInProgress}
        pluginName={plugin.pluginName}
        onClose={() => setUploadOpen(false)}
        onCancelUpload={onCancelUpload}
        onUpload={async (filePath) => {
          setUploading(true)
          try {
            await onUpload(filePath)
          } finally {
            setUploading(false)
          }
        }}
      />
    </>
  )
}

function LocalVersionRow({ version }: { version: PluginAdminVersion }): React.JSX.Element {
  const { t } = useI18n()
  return (
    <div className="bg-amber-500/5 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[13px] font-semibold text-foreground">
              {version.version}
            </span>
            <span className="rounded-full border border-amber-500/35 bg-amber-500/14 px-1.5 py-0.5 text-[10.5px] font-semibold leading-none text-amber-800 dark:text-amber-200">
              {t('developer.plugins.version.localOnly')}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
            <span>
              {t('developer.plugins.version.uploaded', {
                date: formatPluginAdminDate(version.uploadedAt)
              })}
            </span>
            <span>
              {t('developer.plugins.version.size', {
                size: formatPluginAdminBytes(version.packageSizeBytes)
              })}
            </span>
            <span className="font-mono">
              {t('developer.plugins.version.sha', {
                sha: version.packageSha256.slice(0, 12)
              })}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
