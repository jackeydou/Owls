import type { I18nKey } from '@renderer/lib/i18n'
import { useI18n } from '@renderer/lib/i18n'
import type { ThemeMode } from '@renderer/lib/theme'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { SettingsCard, SettingsRow, SettingsSection, SettingsSegmentedControl } from './settings-ui'

const THEME_OPTIONS: Array<{
  value: ThemeMode
  labelKey: I18nKey
}> = [
  { value: 'light', labelKey: 'appearance.theme.light' },
  { value: 'dark', labelKey: 'appearance.theme.dark' },
  { value: 'system', labelKey: 'appearance.theme.system' }
]

export function AppearanceTab(): React.JSX.Element {
  const { t } = useI18n()
  const themeMode = useSettingsStore((state) => state.themeMode)
  const updateThemeMode = useSettingsStore((state) => state.updateThemeMode)

  return (
    <div className="space-y-10">
      <SettingsSection title={t('appearance.section.theme')}>
        <SettingsCard>
          <SettingsRow
            label={t('appearance.theme.label')}
            description={t('appearance.theme.description')}
          >
            <SettingsSegmentedControl
              value={themeMode}
              onChange={(value) => void updateThemeMode(value)}
              options={THEME_OPTIONS.map((option) => ({
                value: option.value,
                label: t(option.labelKey)
              }))}
            />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </div>
  )
}
