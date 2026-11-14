import { AppHotkeyBadge } from '@renderer/components/AppHotkeyBadge'
import { type I18nKey, useI18n } from '@renderer/lib/i18n'
import { APP_HOTKEYS } from '../../../../shared/app-hotkeys'
import { SettingsCard, SettingsRow, SettingsSection } from './settings-ui'

export function HotkeysTab(): React.JSX.Element {
  const { t } = useI18n()

  return (
    <SettingsSection title={t('hotkeys.title')} description={t('hotkeys.description')}>
      <SettingsCard>
        {APP_HOTKEYS.map((hotkey) => (
          <SettingsRow
            key={hotkey.id}
            label={t(hotkey.labelKey as I18nKey)}
            description={t(hotkey.descriptionKey as I18nKey)}
          >
            <AppHotkeyBadge
              shortcut={hotkey.keys}
              className="flex h-[30px] shrink-0 items-center gap-1 rounded-lg bg-foreground/5 px-2.5 text-[12px] font-medium text-foreground"
            />
          </SettingsRow>
        ))}
      </SettingsCard>
    </SettingsSection>
  )
}
