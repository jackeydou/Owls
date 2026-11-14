import type { ReactNode } from 'react'
import { SettingsButton } from './settings-ui'

export function SettingsDialog({
  title,
  description,
  children,
  actions,
  closeLabel,
  onClose
}: {
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  actions: ReactNode
  closeLabel: string
  onClose: () => void
}): React.JSX.Element {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 px-4 py-6 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-[78vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border/70 bg-card shadow-2xl"
      >
        <div className="shrink-0 border-b border-border/55 px-4 py-3">
          <h2 className="text-[14px] font-semibold leading-5 text-foreground">{title}</h2>
          {description ? (
            <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">{description}</p>
          ) : null}
        </div>
        <div className="min-h-0 overflow-y-auto p-4">{children}</div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-border/55 px-4 py-3">
          {actions}
        </div>
      </div>
      <button
        type="button"
        aria-label={closeLabel}
        className="absolute inset-0 -z-10 cursor-default"
        onClick={onClose}
      />
    </div>
  )
}

export function SettingsDialogCancel({
  children,
  onClick
}: {
  children: ReactNode
  onClick: () => void
}): React.JSX.Element {
  return <SettingsButton onClick={onClick}>{children}</SettingsButton>
}
