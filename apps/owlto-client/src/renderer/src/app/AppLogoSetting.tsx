import { Button } from '@renderer/components/ui/button'
import { AnchoredPopover } from '@renderer/components/ui/popover'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { appLogoSchema } from '../../../shared/app'
import { appLogoIcons } from './AppLogo'
import { SettingRow } from './SettingRow'
import { useAppStore } from './store'

/** The app logo row: the chosen logo, and a Change button that opens the picker. */
export function AppLogoSetting() {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const saveSettings = useAppStore((s) => s.saveSettings)
  const pickerLabel = useId()
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement | null>(null)
  return (
    <SettingRow label={t('appLogo')} description={t('appLogoHelp')}>
      <div className="owlto-logo-current">
        <span className="owlto-logo-option" aria-hidden="true">
          <img src={appLogoIcons[settings.appLogo]} alt="" />
        </span>
        <Button
          ref={(node) => {
            button.current = node
            setAnchor(node)
          }}
          variant="outline"
          size="sm"
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={t('appLogoChangeLabel', { logo: t(`appLogo.${settings.appLogo}`) })}
          onClick={() => setOpen((value) => !value)}
        >
          {t('appLogoChange')}
        </Button>
      </div>
      <AnchoredPopover
        anchor={anchor}
        open={open}
        label={t('appLogo')}
        placement="bottom-end"
        className="p-3"
        onClose={(reason) => {
          setOpen(false)
          if (reason === 'escape') button.current?.focus()
        }}
      >
        <p id={pickerLabel} className="sr-only">
          {t('appLogo')}
        </p>
        <div className="owlto-logo-options" role="radiogroup" aria-labelledby={pickerLabel}>
          {appLogoSchema.options.map((logo) => (
            <label className="owlto-logo-option" key={logo}>
              <input
                type="radio"
                name="owlto-app-logo"
                className="sr-only"
                aria-label={t(`appLogo.${logo}`)}
                checked={settings.appLogo === logo}
                data-autofocus={settings.appLogo === logo || undefined}
                onChange={() => {
                  void saveSettings({ ...settings, appLogo: logo })
                  setOpen(false)
                  button.current?.focus()
                }}
              />
              <img src={appLogoIcons[logo]} alt="" />
            </label>
          ))}
        </div>
      </AnchoredPopover>
    </SettingRow>
  )
}
