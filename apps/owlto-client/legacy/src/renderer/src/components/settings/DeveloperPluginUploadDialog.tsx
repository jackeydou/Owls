import { useI18n } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import { AlertTriangle, CheckCircle2, FileArchive, Loader2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { SettingsDialog } from './SettingsDialog'
import { SettingsButton } from './settings-ui'

function isZipFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.zip')
}

function hasDraggedFiles(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes('Files')
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function DeveloperPluginUploadDialog({
  open,
  busy,
  authLoginInProgress,
  pluginName,
  onClose,
  onCancelUpload,
  onUpload
}: {
  open: boolean
  busy: boolean
  authLoginInProgress: boolean
  pluginName: string
  onClose: () => void
  onCancelUpload: () => void
  onUpload: (filePath: string) => Promise<void>
}): React.JSX.Element | null {
  const { t } = useI18n()
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const dragDepthRef = useRef(0)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasUploadFile = uploadFile !== null

  if (!open) return null

  const closeAndCancel = (): void => {
    if (busy) onCancelUpload()
    onClose()
  }

  const selectUploadFile = (file: File | null): void => {
    if (!file) {
      setUploadFile(null)
      return
    }
    if (!isZipFile(file)) {
      setUploadFile(null)
      setError(t('developer.plugins.upload.invalidFile'))
      return
    }
    setUploadFile(file)
    setError(null)
  }

  const handleDragEnter = (event: React.DragEvent<HTMLButtonElement>): void => {
    if (!hasDraggedFiles(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    dragDepthRef.current += 1
    setDragActive(true)
  }

  const handleDragOver = (event: React.DragEvent<HTMLButtonElement>): void => {
    if (!hasDraggedFiles(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = busy ? 'none' : 'copy'
    setDragActive(true)
  }

  const handleDragLeave = (event: React.DragEvent<HTMLButtonElement>): void => {
    if (!hasDraggedFiles(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setDragActive(false)
  }

  const handleDrop = (event: React.DragEvent<HTMLButtonElement>): void => {
    if (!hasDraggedFiles(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    dragDepthRef.current = 0
    setDragActive(false)
    if (busy) return

    const zipFile = Array.from(event.dataTransfer.files).find(isZipFile) ?? null
    if (!zipFile) {
      setUploadFile(null)
      setError(t('developer.plugins.upload.invalidFile'))
      return
    }
    selectUploadFile(zipFile)
  }

  const submit = async (): Promise<void> => {
    if (!uploadFile) {
      setError(t('developer.plugins.upload.noFile'))
      return
    }
    const filePath = window.api.attachments.getPathForFile(uploadFile)
    if (!filePath) {
      setError(t('developer.plugins.upload.missingPath'))
      return
    }

    setError(null)
    try {
      await onUpload(filePath)
      setUploadFile(null)
      onClose()
    } catch (uploadError) {
      setError(errorMessage(uploadError))
    }
  }

  return (
    <SettingsDialog
      title={t('developer.plugins.upload.dialogTitle')}
      description={t('developer.plugins.upload.dialogDescription', { name: pluginName })}
      closeLabel={t('developer.plugins.upload.cancel')}
      onClose={closeAndCancel}
      actions={
        <>
          <SettingsButton onClick={closeAndCancel}>
            {t('developer.plugins.upload.cancel')}
          </SettingsButton>
          <SettingsButton variant="primary" disabled={busy} onClick={() => void submit()}>
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" strokeWidth={1.8} />
            ) : (
              <Upload className="size-3.5" strokeWidth={1.8} />
            )}
            {authLoginInProgress
              ? t('developer.plugins.upload.authLoginButton')
              : t('developer.plugins.upload.button')}
          </SettingsButton>
        </>
      }
    >
      <div className="space-y-3">
        <div className="rounded-xl border border-amber-500/45 bg-amber-500/12 px-3 py-2.5 text-amber-900 shadow-sm dark:text-amber-100">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
            <div className="min-w-0">
              <div className="inline-flex rounded-full border border-amber-500/45 bg-amber-500/20 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide">
                {t('developer.plugins.version.localOnly')}
              </div>
              <p className="mt-1.5 text-[12.5px] font-medium leading-5">
                {t('developer.plugins.upload.localWarning')}
              </p>
            </div>
          </div>
        </div>
        {authLoginInProgress ? (
          <div
            role="status"
            className="rounded-xl border border-sky-500/35 bg-sky-500/10 px-3 py-2.5 text-sky-900 shadow-sm dark:text-sky-100"
          >
            <div className="flex items-start gap-2.5">
              <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" strokeWidth={2} />
              <div className="min-w-0">
                <div className="text-[12.5px] font-semibold leading-5">
                  {t('developer.plugins.upload.authLoginTitle')}
                </div>
                <p className="mt-0.5 text-[12px] font-medium leading-5 text-sky-900/75 dark:text-sky-100/75">
                  {t('developer.plugins.upload.authLoginDescription')}
                </p>
              </div>
            </div>
          </div>
        ) : null}
        <div>
          <div className="text-[12px] font-medium text-foreground">
            {t('developer.plugins.upload.fileLabel')}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              ref={uploadInputRef}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={(event) => {
                selectUploadFile(event.target.files?.[0] ?? null)
              }}
            />
            <button
              type="button"
              disabled={busy}
              aria-label={t('developer.plugins.upload.dropZoneLabel')}
              onClick={() => {
                uploadInputRef.current?.click()
              }}
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={cn(
                'flex min-h-[116px] flex-1 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-foreground/2.5 px-4 py-5 text-center transition',
                'hover:border-border-strong hover:bg-foreground/4 focus:outline-none focus:ring-2 focus:ring-foreground/10',
                hasUploadFile &&
                  'border-emerald-500/45 bg-emerald-500/8 hover:border-emerald-500/60 hover:bg-emerald-500/10',
                busy &&
                  'cursor-not-allowed opacity-60 hover:border-border/80 hover:bg-foreground/2.5',
                dragActive &&
                  'border-sky-500/60 bg-sky-500/8 ring-2 ring-sky-500/15 dark:bg-sky-500/12'
              )}
            >
              <div
                className={cn(
                  'flex size-10 items-center justify-center rounded-full border border-border/70 bg-card text-muted-foreground shadow-sm',
                  hasUploadFile &&
                    'border-emerald-500/35 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
                  dragActive && 'border-sky-500/35 bg-sky-500/10 text-sky-600 dark:text-sky-300'
                )}
              >
                {hasUploadFile ? (
                  <CheckCircle2 className="size-4" strokeWidth={1.9} />
                ) : (
                  <Upload className="size-4" strokeWidth={1.8} />
                )}
              </div>
              <div className="mt-3 text-[13px] font-medium text-foreground">
                {dragActive
                  ? t('developer.plugins.upload.dropActive')
                  : hasUploadFile
                    ? t('developer.plugins.upload.selectedTitle')
                    : t('developer.plugins.upload.dropTitle')}
              </div>
              {uploadFile ? (
                <div className="mt-3 flex w-full max-w-[360px] items-center gap-2 rounded-xl border border-emerald-500/25 bg-card/85 p-2.5 text-left shadow-sm">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
                    <FileArchive className="size-4" strokeWidth={1.8} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-semibold text-foreground">
                      {uploadFile.name}
                    </div>
                    <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                      {formatBytes(uploadFile.size)}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10.5px] font-medium text-emerald-700 dark:text-emerald-300">
                    {t('developer.plugins.upload.selectedBadge')}
                  </span>
                </div>
              ) : (
                <div className="mt-1 max-w-full truncate text-[12px] leading-5 text-muted-foreground">
                  {t('developer.plugins.upload.dropDescription')}
                </div>
              )}
              <span className="mt-3 inline-flex h-[34px] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-foreground/5 px-3 text-[13px] font-medium text-foreground transition">
                {hasUploadFile
                  ? t('developer.plugins.upload.replaceFile')
                  : t('developer.plugins.upload.chooseFile')}
              </span>
            </button>
          </div>
          <p className="mt-2 text-[12px] leading-5 text-muted-foreground">
            {t('developer.plugins.upload.description')}
          </p>
        </div>
        {error ? <p className="text-[12px] leading-5 text-destructive">{error}</p> : null}
      </div>
    </SettingsDialog>
  )
}
