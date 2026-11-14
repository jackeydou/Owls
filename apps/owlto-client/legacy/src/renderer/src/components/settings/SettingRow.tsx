import { SettingsCard, SettingsRow as SettingsCardRow } from './settings-ui'

export function SettingRow({
  label,
  description,
  children
}: {
  label: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-3 last:mb-0">
      <SettingsCard>
        <SettingsCardRow label={label} description={description} className="items-start">
          {children}
        </SettingsCardRow>
      </SettingsCard>
    </div>
  )
}
