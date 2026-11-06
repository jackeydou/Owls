import { Select } from '@renderer/components/ui/select'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { CodexSettings } from '../../../shared/codex'
import { effortSchema, permissionSchema, providerSchema } from '../../../shared/codex'
import { agentConnection, agentSelection, useCodexStore } from './store'

export function TaskOptions({
  disabled = false,
  compact = false
}: {
  disabled?: boolean
  compact?: boolean
}) {
  const { t } = useTranslation()
  const settings = useCodexStore((s) => s.settings)
  const provider = settings.provider
  const models = useCodexStore((s) => agentConnection(s, provider).models)
  const save = useCodexStore((s) => s.saveSettings)
  const id = useId()
  const agent = t(`agent.${provider}`)
  const { model, effort } = agentSelection(settings, provider)
  const selected = models.find((m) => m.id === model)
  const efforts = selected?.efforts ?? []
  function saveSelection(next: { model: string | null; effort: string | null }) {
    const update: CodexSettings =
      provider === 'claude-code'
        ? { ...settings, claudeModel: next.model, claudeEffort: next.effort }
        : { ...settings, model: next.model, effort: next.effort }
    void save(update)
  }
  return (
    <div className={compact ? 'codex-options compact' : 'codex-options'}>
      <label htmlFor={`${id}-agent`}>
        <span>{t('agent')}</span>
        <Select
          id={`${id}-agent`}
          value={provider}
          disabled={disabled}
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
      </label>
      <label htmlFor={`${id}-model`}>
        <span>{t('model')}</span>
        <Select
          id={`${id}-model`}
          value={model ?? '__default__'}
          disabled={disabled || !models.length}
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
      </label>
      {!compact || efforts.length ? (
        <label htmlFor={`${id}-effort`}>
          <span>{t('effort')}</span>
          <Select
            id={`${id}-effort`}
            value={effort ?? '__default__'}
            disabled={disabled || !efforts.length}
            onChange={(event) =>
              saveSelection({
                model,
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
        </label>
      ) : null}
      <label htmlFor={`${id}-permission`}>
        <span>{t('permission')}</span>
        <Select
          id={`${id}-permission`}
          value={settings.permission}
          disabled={disabled}
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
      </label>
    </div>
  )
}
