import { ActionButton, ActionIconButton } from '@renderer/components/ui/action-button'
import { Button } from '@renderer/components/ui/button'
import { FolderOpenIcon, PlusIcon, TrashIcon } from '@renderer/components/ui/icons'
import { Select } from '@renderer/components/ui/select'
import { Switch } from '@renderer/components/ui/switch'
import { type FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type BrowserSite,
  type BrowserSiteRule,
  browserSiteRuleSchema,
  siteHost
} from '../../../shared/browser-panel'
import { browserActions } from '../browser/store'
import { SettingRow } from './SettingRow'
import { useAppStore } from './store'

const bySite = (a: BrowserSite, b: BrowserSite) => a.host.localeCompare(b.host)

function RuleSelect({
  id,
  value,
  label,
  onChange
}: {
  id?: string
  value: BrowserSiteRule
  label: string
  onChange: (rule: BrowserSiteRule) => void
}) {
  const { t } = useTranslation()
  return (
    <Select
      id={id}
      aria-label={label}
      value={value}
      onChange={(event) => onChange(browserSiteRuleSchema.parse(event.target.value))}
    >
      {browserSiteRuleSchema.options.map((rule) => (
        <option key={rule} value={rule}>
          {t(`browserSettings.rule.${rule}`)}
        </option>
      ))}
    </Select>
  )
}

/** Sites workers may browse freely, must ask about first, or may never open. */
function SiteRules() {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const saveSettings = useAppStore((s) => s.saveSettings)
  const [draft, setDraft] = useState('')
  const [rule, setRule] = useState<BrowserSiteRule>('ask')
  const host = siteHost(draft)
  const sites = [...settings.browser.sites].sort(bySite)
  const saveSites = (next: BrowserSite[]) =>
    saveSettings({ ...settings, browser: { ...settings.browser, sites: next.sort(bySite) } })
  const add = (event: FormEvent) => {
    event.preventDefault()
    if (!host) return
    setDraft('')
    void saveSites([...sites.filter((site) => site.host !== host), { host, rule }])
  }
  return (
    <SettingRow
      label={t('browserSettings.sites')}
      description={t('browserSettings.sitesHelp')}
      detail={
        <>
          <form className="owlto-browser-site-add" onSubmit={add}>
            <input
              className="router-input"
              aria-label={t('browserSettings.siteLabel')}
              placeholder={t('browserSettings.sitePlaceholder')}
              spellCheck={false}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <RuleSelect value={rule} label={t('browserSettings.ruleLabel')} onChange={setRule} />
            <Button type="submit" size="sm" variant="outline" disabled={!host}>
              <PlusIcon size={15} />
              {t('browserSettings.addSite')}
            </Button>
          </form>
          {sites.length ? (
            <ul className="owlto-browser-sites" aria-label={t('browserSettings.sites')}>
              {sites.map((site) => (
                <li key={site.host}>
                  <span>{site.host}</span>
                  <RuleSelect
                    value={site.rule}
                    label={t('browserSettings.ruleFor', { host: site.host })}
                    onChange={(next) =>
                      void saveSites(
                        sites.map((s) => (s.host === site.host ? { ...s, rule: next } : s))
                      )
                    }
                  />
                  <ActionIconButton
                    size="sm"
                    label={t('browserSettings.removeSite', { host: site.host })}
                    tooltip={t('browserSettings.removeSite', { host: site.host })}
                    icon={<TrashIcon size={15} />}
                    onAction={() => saveSites(sites.filter((s) => s.host !== site.host))}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="owlto-browser-sites-empty">{t('browserSettings.sitesEmpty')}</p>
          )}
        </>
      }
    />
  )
}

function DownloadsRow() {
  const { t } = useTranslation()
  const saved = useAppStore((s) => s.settings.browserDownloadsPath)
  const [folder, setFolder] = useState<string | null>(null)
  // Reads the folder again whenever the saved choice changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `saved` is the trigger, not an input.
  useEffect(() => {
    let live = true
    void browserActions.downloadsFolder().then((path) => {
      if (live && path) setFolder(path)
    })
    return () => {
      live = false
    }
  }, [saved])
  return (
    <SettingRow
      label={t('browserSettings.downloads')}
      description={t('browserSettings.downloadsHelp')}
      detail={folder ? <code className="owlto-path">{folder}</code> : null}
    >
      <div className="owlto-settings-actions">
        <ActionButton
          size="sm"
          variant="ghost"
          onAction={async () => {
            await browserActions.revealDownloadsFolder()
            return 'quiet'
          }}
        >
          {t('browserSettings.reveal')}
        </ActionButton>
        <ActionButton
          size="sm"
          variant="outline"
          icon={<FolderOpenIcon size={16} />}
          onAction={async () => {
            const path = await browserActions.pickDownloadsFolder()
            if (!path) return 'quiet'
            setFolder(path)
            useAppStore.setState((s) => ({
              settings: { ...s.settings, browserDownloadsPath: path }
            }))
            return 'done'
          }}
        >
          {t('browserSettings.choose')}
        </ActionButton>
      </div>
    </SettingRow>
  )
}

/** Whether workers get the iOS Simulator tools, and the devices the user let them use. */
function SimulatorSettings() {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const saveSettings = useAppStore((s) => s.saveSettings)
  const allowed = settings.simulator.allowedDevices.length
  return (
    <>
      <h3 className="owlto-settings-subhead">{t('simulatorSettings.title')}</h3>
      <SettingRow
        label={t('simulatorSettings.enabled')}
        htmlFor="simulator-enabled"
        description={t('simulatorSettings.enabledHelp')}
      >
        <Switch
          id="simulator-enabled"
          checked={settings.simulator.enabled}
          onCheckedChange={(enabled) =>
            void saveSettings({ ...settings, simulator: { ...settings.simulator, enabled } })
          }
        />
      </SettingRow>
      <SettingRow
        label={t('simulatorSettings.allowed')}
        description={
          allowed
            ? t('simulatorSettings.allowedCount', { count: allowed })
            : t('simulatorSettings.allowedNone')
        }
      >
        <ActionButton
          size="sm"
          variant="outline"
          disabled={!allowed}
          doneLabel={t('simulatorSettings.forgotten')}
          onAction={async () => {
            await saveSettings({
              ...settings,
              simulator: { ...settings.simulator, allowedDevices: [] }
            })
            const left = useAppStore.getState().settings.simulator.allowedDevices.length
            return left ? 'quiet' : 'done'
          }}
        >
          {t('simulatorSettings.forget')}
        </ActionButton>
      </SettingRow>
    </>
  )
}

/** Settings → Browser: what workers may do in Owlto's browser, its sign-ins and downloads. */
export function BrowserSettingsPane() {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const saveSettings = useAppStore((s) => s.saveSettings)
  return (
    <section className="owlto-settings-section">
      <h2>{t('browserSettings.title')}</h2>
      <p>{t('browserSettings.body')}</p>
      <SiteRules />
      <SettingRow
        label={t('browserSettings.askBeforeSubmit')}
        htmlFor="browser-ask-before-submit"
        description={t('browserSettings.askBeforeSubmitHelp')}
      >
        <Switch
          id="browser-ask-before-submit"
          checked={settings.browser.askBeforeSubmit}
          onCheckedChange={(askBeforeSubmit) =>
            void saveSettings({ ...settings, browser: { ...settings.browser, askBeforeSubmit } })
          }
        />
      </SettingRow>
      <DownloadsRow />
      <SettingRow
        label={t('browserSettings.signIns')}
        description={t('browserSettings.signInsHelp')}
      >
        <ActionButton
          size="sm"
          variant="outline"
          doneLabel={t('browserSettings.cleared')}
          onAction={async () => ((await browserActions.clearSignIns()) ? 'done' : 'quiet')}
        >
          {t('browserSettings.clearSignIns')}
        </ActionButton>
      </SettingRow>
      <SimulatorSettings />
    </section>
  )
}
