import { cn } from '@renderer/lib/utils'
import type { ButtonHTMLAttributes } from 'react'

type SwitchProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'role'> & {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

/**
 * An on/off toggle for settings: a `role="switch"` button, so a `<label htmlFor>` with its id
 * names it and clicking the label flips it. The styles live in `.owlto-switch` in
 * `assets/main.css`.
 */
export function Switch({ checked, onCheckedChange, className, onClick, ...props }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={cn('owlto-switch', className)}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) onCheckedChange(!checked)
      }}
      {...props}
    >
      <span className="owlto-switch-thumb" aria-hidden="true" />
    </button>
  )
}
