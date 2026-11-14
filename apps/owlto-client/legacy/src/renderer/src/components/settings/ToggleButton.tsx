import { SettingsSwitch } from './settings-ui'

export function ToggleButton({
  checked,
  disabled,
  onClick
}: {
  checked: boolean
  disabled?: boolean
  onClick: () => void
}): React.JSX.Element {
  return <SettingsSwitch checked={checked} disabled={disabled} onClick={onClick} />
}
