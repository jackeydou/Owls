import { Switch } from '@renderer/components/ui/switch'
import { useTranslation } from 'react-i18next'
import { NotesICloudSetting } from '../cards/SettingsNotes'
import { SettingRow } from './SettingRow'
import { useAppStore } from './store'

/** Switches for experimental features; each is off until the user turns it on. */
export function ExperimentsSettingsPane() {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const saveSettings = useAppStore((s) => s.saveSettings)
  const { experiments } = settings
  return (
    <section className="owlto-settings-section">
      <h2>{t('experiments.title')}</h2>
      <p>{t('experiments.body')}</p>
      <SettingRow
        label={t('experiments.manualDreaming')}
        htmlFor="experiments-manual-dreaming"
        description={
          experiments.manualDreaming && !settings.memory.learn
            ? `${t('experiments.manualDreamingHelp')} ${t('experiments.learnOff')}`
            : t('experiments.manualDreamingHelp')
        }
      >
        <Switch
          id="experiments-manual-dreaming"
          checked={experiments.manualDreaming}
          onCheckedChange={(manualDreaming) =>
            void saveSettings({ ...settings, experiments: { ...experiments, manualDreaming } })
          }
        />
      </SettingRow>
      <NotesICloudSetting />
    </section>
  )
}
