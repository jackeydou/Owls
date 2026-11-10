import { Select } from '@renderer/components/ui/select'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppSettings } from '../../../shared/app'
import { effortSchema, permissionSchema, providerSchema } from '../../../shared/app'
import { SettingRow } from './SettingRow'
import { agentConnection, agentSelection, useAppStore } from './store'

/** The defaults a new worker starts with. */
export function TaskOptions() {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const provider = settings.provider
  const models = useAppStore((s) => agentConnection(s, provider).models)
  const save = useAppStore((s) => s.saveSettings)
  const id = useId()
  const agent = t(`agent.${provider}`)
  const claudeAgent = provider === 'claude-code'
  const { model, effort } = agentSelection(settings, provider)
  const selected = models.find((m) => m.id === model)
  const efforts = selected?.efforts ?? []
  function saveSelection(next: { model: string | null; effort: string | null }) {
    const update: AppSettings = claudeAgent
      ? { ...settings, claudeModel: next.model, claudeEffort: next.effort }
      : { ...settings, model: next.model, effort: next.effort }
    void save(update)
  }
  return (
    <>
      <SettingRow label={t('agent')} htmlFor={`${id}-agent`}>
        <Select
          id={`${id}-agent`}
          value={provider}
          onChange={(event) =>
            void save({ ...settings, provider: providerSchema.parse(event.target.value) })
          }
        >
          {providerSchema.options.map((option) => (
            <option key={option} value={option}>
              {t(`agent.${option}`)}
            </option>
          ))}
        </Select>
      </SettingRow>
      <SettingRow
        label={t('model')}
        htmlFor={`${id}-model`}
        description={
          models.length ? null : t(claudeAgent ? 'claudeAccountUnavailable' : 'accountUnavailable')
        }
      >
        <Select
          id={`${id}-model`}
          value={model ?? '__default__'}
          disabled={!models.length}
          onChange={(event) => {
            const next = event.target.value === '__default__' ? null : event.target.value
            saveSelection({
              model: next,
              effort: next ? (models.find((m) => m.id === next)?.defaultEffort ?? null) : null
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
      <SettingRow label={t('effort')} htmlFor={`${id}-effort`}>
        <Select
          id={`${id}-effort`}
          value={effort ?? '__default__'}
          disabled={!efforts.length}
          onChange={(event) =>
            saveSelection({
              model,
              effort:
                event.target.value === '__default__' ? null : effortSchema.parse(event.target.value)
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
      <SettingRow
        label={t('permission')}
        htmlFor={`${id}-permission`}
        description={t(
          settings.permission === 'full-access'
            ? claudeAgent
              ? 'claudeFullAccessHelp'
              : 'fullAccessHelp'
            : claudeAgent
              ? 'claudePermissionHelp'
              : 'permissionHelp'
        )}
      >
        <Select
          id={`${id}-permission`}
          value={settings.permission}
          onChange={(event) =>
            void save({ ...settings, permission: permissionSchema.parse(event.target.value) })
          }
        >
          {permissionSchema.options.map((permission) => (
            <option key={permission} value={permission}>
              {t(`permission.${permission}`)}
            </option>
          ))}
        </Select>
      </SettingRow>
    </>
  )
}
