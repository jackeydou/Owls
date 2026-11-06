import { Switch } from '@renderer/components/ui/switch'
import { cn } from '@renderer/lib/utils'
import { ChevronDown } from 'lucide-react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

export function SettingsSection({
  title,
  description,
  action,
  children
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
}): React.JSX.Element {
  return (
    <section>
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-medium leading-5 text-foreground">{title}</h2>
          {description ? (
            <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}

export function SettingsCard({
  children,
  className
}: {
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('overflow-hidden rounded-xl border border-border/70 bg-card', className)}>
      {children}
    </div>
  )
}

export function SettingsRow({
  label,
  description,
  children,
  className
}: {
  label: ReactNode
  description?: ReactNode
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex min-h-[66px] items-center justify-between gap-6 border-b border-border/55 px-3.5 py-3 last:border-b-0',
        className
      )}
    >
      <div className="min-w-0 flex-1">
        <h3 className="text-[13px] font-medium leading-5 text-foreground">{label}</h3>
        {description ? (
          <p className="mt-0.5 text-[12.5px] leading-[1.35] text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center justify-end">{children}</div>
    </div>
  )
}

export function SettingsSelect<T extends string>({
  id,
  value,
  onChange,
  options,
  className
}: {
  id?: string
  value: T
  onChange: (value: T) => void
  options: Array<{ value: T; label: string }>
  className?: string
}): React.JSX.Element {
  return (
    <label className={cn('relative block w-[256px]', className)}>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="h-[30px] w-full appearance-none rounded-lg border-0 bg-foreground/5 px-3 pr-8 text-[13px] font-normal text-foreground outline-none transition hover:bg-foreground/7 focus:ring-2 focus:ring-foreground/10"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        strokeWidth={1.8}
      />
    </label>
  )
}

export function SettingsSwitch({
  checked,
  disabled,
  onClick
}: {
  checked: boolean
  disabled?: boolean
  onClick: () => void
}): React.JSX.Element {
  return <Switch checked={checked} disabled={disabled} onCheckedChange={onClick} size="md" />
}

export function SettingsTextInput({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  return (
    <input
      className={cn(
        'h-[34px] rounded-lg border border-border/70 bg-background px-3 text-[13px] text-foreground outline-none transition placeholder:text-muted-foreground/55 hover:bg-foreground/2 focus:border-border-strong focus:ring-2 focus:ring-foreground/8 disabled:cursor-not-allowed disabled:opacity-60',
        className
      )}
      {...props}
    />
  )
}

export function SettingsButton({
  variant = 'secondary',
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger'
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-[34px] shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-45',
        variant === 'primary' &&
          'bg-foreground text-background hover:bg-foreground/90 disabled:hover:bg-foreground',
        variant === 'secondary' && 'bg-foreground/5 text-foreground hover:bg-foreground/8',
        variant === 'danger' &&
          'bg-destructive/10 text-destructive hover:bg-destructive/15 disabled:hover:bg-destructive/10',
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export function SettingsSegmentedControl<T extends string>({
  value,
  onChange,
  options
}: {
  value: T
  onChange: (value: T) => void
  options: Array<{ value: T; label: ReactNode }>
}): React.JSX.Element {
  return (
    <div className="inline-flex rounded-lg bg-foreground/5 p-1">
      {options.map((option) => {
        const active = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-md px-3 py-1 text-[13px] font-normal leading-5 transition',
              active
                ? 'bg-card text-foreground shadow-[0_1px_2px_rgb(0_0_0_/_0.12)]'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
