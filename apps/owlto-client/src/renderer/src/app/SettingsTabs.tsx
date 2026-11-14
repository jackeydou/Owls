import { type ReactNode, useId } from 'react'

export type SettingsTabItem<T extends string> = { id: T; label: string; icon: ReactNode }

/**
 * Underlined tabs across the top of a settings page, with the open tab's rows below.
 * Arrow keys move between tabs, as in any tab list.
 */
export function SettingsTabs<T extends string>({
  label,
  tabs,
  current,
  onSelect,
  children
}: {
  label: string
  tabs: SettingsTabItem<T>[]
  current: T
  onSelect(tab: T): void
  children: ReactNode
}) {
  const id = useId()
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    event.preventDefault()
    const index = tabs.findIndex((tab) => tab.id === current)
    const next = tabs[(index + step + tabs.length) % tabs.length].id
    onSelect(next)
    document.getElementById(`${id}-${next}`)?.focus()
  }
  return (
    <>
      <div className="owlto-settings-tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {tabs.map((tab) => (
          <button
            type="button"
            role="tab"
            key={tab.id}
            id={`${id}-${tab.id}`}
            aria-selected={tab.id === current}
            aria-controls={`${id}-panel`}
            tabIndex={tab.id === current ? 0 : -1}
            onClick={() => onSelect(tab.id)}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>
      <div
        className="owlto-settings-tabpanel"
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-${current}`}
        key={current}
      >
        {children}
      </div>
    </>
  )
}
