import { Button } from '@renderer/components/ui/button'
import { ChoiceSelect } from '@renderer/components/ui/choice-select'
import { ChevronDownIcon, ChevronRightIcon } from '@renderer/components/ui/icons'
import { Select } from '@renderer/components/ui/select'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import {
  type AgentConfig,
  type AgentProvider,
  agentPermissions,
  effortSchema,
  type Permission,
  providerSchema
} from '../../../shared/agents'
import { AgentIcon } from '../router/AgentIcon'
import { permissionChoices } from './permission-choices'
import { SettingRow } from './SettingRow'
import { agentConnection, isAgentReady, useAppStore } from './store'

/** How each provider enforces the chosen permission. */
function permissionHelp(provider: AgentProvider, permission: Permission): string {
  if (permission === 'read-only') return 'readOnlyHelp'
  const full = permission === 'full-access'
  if (provider === 'claude-code') return full ? 'claudeFullAccessHelp' : 'claudePermissionHelp'
  if (provider === 'cursor') return 'cursorFullAccessHelp'
  return full ? 'fullAccessHelp' : 'permissionHelp'
}

/** One coding agent's settings for new workers, folded behind a header that sums them up. */
function AgentConfigRows({ provider }: { provider: AgentProvider }) {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const models = useAppStore((s) => agentConnection(s, provider).models)
  const save = useAppStore((s) => s.saveSettings)
  const id = useId()
  const [open, setOpen] = useState(false)
  const agent = t(`agent.${provider}`)
  const config = settings.agents[provider]
  const efforts = models.find((m) => m.id === config.model)?.efforts ?? []
  function saveConfig(next: Partial<AgentConfig>) {
    void save({ ...settings, agents: { ...settings.agents, [provider]: { ...config, ...next } } })
  }
  const modelName = config.model
    ? (models.find((m) => m.id === config.model)?.name ?? config.model)
    : t('nativeDefault', { agent })
  const summary = [modelName, t(`permission.${config.permission}`)].join(' · ')
  return (
    <div className="owlto-agent-config" data-open={open || undefined}>
      <h3>
        <button
          type="button"
          className="owlto-agent-config-toggle"
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          onClick={() => setOpen(!open)}
        >
          <AgentIcon provider={provider} />
          <span className="owlto-agent-config-name">{agent}</span>
          <small>{summary}</small>
          {open ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} />}
        </button>
      </h3>
      {open ? (
        <div className="owlto-agent-config-panel" id={`${id}-panel`}>
          <SettingRow label={t('model')} htmlFor={`${id}-model`}>
            <Select
              id={`${id}-model`}
              value={config.model ?? '__default__'}
              onChange={(event) => {
                const model = event.target.value === '__default__' ? null : event.target.value
                saveConfig({
                  model,
                  effort: model ? (models.find((m) => m.id === model)?.defaultEffort ?? null) : null
                })
              }}
            >
              <option value="__default__">{t('nativeDefault', { agent })}</option>
              {models.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          </SettingRow>
          {/* Cursor has no reasoning effort setting. */}
          {provider === 'cursor' ? null : (
            <SettingRow label={t('effort')} htmlFor={`${id}-effort`}>
              <Select
                id={`${id}-effort`}
                value={config.effort ?? '__default__'}
                disabled={!efforts.length}
                onChange={(event) =>
                  saveConfig({
                    effort:
                      event.target.value === '__default__'
                        ? null
                        : effortSchema.parse(event.target.value)
                  })
                }
              >
                <option value="__default__">{t('nativeDefault', { agent })}</option>
                {efforts.map((option) => (
                  <option key={option} value={option}>
                    {t(`effort.${option}`, { defaultValue: option })}
                  </option>
                ))}
              </Select>
            </SettingRow>
          )}
          <SettingRow
            label={t('permission')}
            htmlFor={`${id}-permission`}
            description={t(permissionHelp(provider, config.permission))}
          >
            <ChoiceSelect
              id={`${id}-permission`}
              value={config.permission}
              choices={permissionChoices(t).filter((c) =>
                agentPermissions(provider).includes(c.value)
              )}
              onChange={(permission) => saveConfig({ permission })}
            />
          </SettingRow>
        </div>
      ) : null}
    </div>
  )
}

/** Each connected coding agent's own settings for the workers it runs. */
export function WorkerAgentSettings() {
  const { t } = useTranslation()
  const showAgentSettings = useAppStore((s) => s.showAgentSettings)
  const ready = useAppStore(
    useShallow((s) => providerSchema.options.filter((p) => isAgentReady(agentConnection(s, p))))
  )
  const missing = providerSchema.options.filter((p) => !ready.includes(p))
  return (
    <>
      {ready.map((provider) => (
        <AgentConfigRows key={provider} provider={provider} />
      ))}
      {missing.length ? (
        <p className="owlto-note">
          {t(ready.length ? 'workerAgents.missing' : 'workerAgents.none', {
            agents: missing.map((p) => t(`agent.${p}`)).join(t('workerAgents.listSeparator'))
          })}
          <Button
            size="custom"
            variant="link"
            className="owlto-inline-link"
            onClick={() => showAgentSettings(missing[0])}
          >
            {t('workerAgents.connect')}
          </Button>
        </p>
      ) : null}
    </>
  )
}
