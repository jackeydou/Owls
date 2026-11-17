import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { cn } from '@renderer/lib/utils'
import type { ReactNode } from 'react'
import { CheckIcon, type IconComponent } from './icons'
import { MenuContent } from './menu'

export type Choice<T extends string> = {
  value: T
  label: string
  description: string
  icon: IconComponent
  /** `danger` tints the whole row, for a choice that removes safeguards. */
  tone?: 'danger'
}

/**
 * A select whose options carry an icon and a one-line description, for choices
 * that need explaining (such as permissions). The trigger matches the shared
 * `Select`; the list is a Radix menu of radio items, so it keeps keyboard
 * navigation, typeahead, and the `menuitemradio` role.
 */
export function ChoiceSelect<T extends string>({
  id,
  value,
  choices,
  onChange,
  disabled,
  className
}: {
  id?: string
  value: T
  choices: Choice<T>[]
  onChange: (value: T) => void
  disabled?: boolean
  className?: string
}): ReactNode {
  const current = choices.find((choice) => choice.value === value)
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        id={id}
        disabled={disabled}
        className={cn('owlto-select-button', className)}
      >
        {current?.label ?? value}
      </DropdownMenu.Trigger>
      <MenuContent align="end" className="max-w-[min(480px,calc(100vw-32px))] p-1.5">
        <DropdownMenu.RadioGroup
          value={value}
          onValueChange={(next) => {
            const choice = choices.find((c) => c.value === next)
            if (choice) onChange(choice.value)
          }}
        >
          {choices.map((choice) => {
            const Icon = choice.icon
            return (
              <DropdownMenu.RadioItem
                key={choice.value}
                value={choice.value}
                data-tone={choice.tone}
                className="grid cursor-default select-none grid-cols-[20px_1fr_16px] items-start gap-x-3 rounded-(--owl-radius-sm) px-2.5 py-2 outline-none data-[highlighted]:bg-card-muted data-[tone=danger]:text-destructive"
              >
                <Icon size={20} className="mt-px" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-(length:--owl-text-sm) leading-(--owl-leading-tight)">
                    {choice.label}
                  </span>
                  <span className="text-(length:--owl-text-xs) text-muted-foreground in-data-[tone=danger]:text-destructive/80">
                    {choice.description}
                  </span>
                </span>
                <DropdownMenu.ItemIndicator className="mt-0.5 self-center">
                  <CheckIcon size={16} />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            )
          })}
        </DropdownMenu.RadioGroup>
      </MenuContent>
    </DropdownMenu.Root>
  )
}
