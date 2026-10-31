import { Select } from '@renderer/components/ui/select'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { effortSchema, permissionSchema } from '../../../shared/codex'
import { useCodexStore } from './store'

export function TaskOptions({
  disabled = false,
  compact = false
}: {
  disabled?: boolean
  compact?: boolean
}) {
  const { t } = useTranslation()
  const settings = useCodexStore((s) => s.settings)
  const models = useCodexStore((s) => s.connection.models)
  const save = useCodexStore((s) => s.saveSettings)
  const id = useId()
  const selected = models.find((m) => m.id === settings.model)
  const efforts = selected?.efforts ?? []
  return (
    <div className={compact ? 'codex-options compact' : 'codex-options'}>
      <label htmlFor={`${id}-model`}>
        <span>{t('model')}</span>
        <Select
          id={`${id}-model`}
          value={settings.model ?? '__default__'}
          disabled={disabled || !models.length}
          onChange={(event) => {
            const model = event.target.value === '__default__' ? null : event.target.value
            void save({
              ...settings,
              model,
              effort: model ? (models.find((m) => m.id === model)?.defaultEffort ?? null) : null
            })
          }}
        >
          <option value="__default__">{t('nativeDefault')}</option>
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </Select>
      </label>
      {!compact || efforts.length ? (
        <label htmlFor={`${id}-effort`}>
          <span>{t('effort')}</span>
          <Select
            id={`${id}-effort`}
            value={settings.effort ?? '__default__'}
            disabled={disabled || !efforts.length}
            onChange={(event) =>
              void save({
                ...settings,
                effort:
                  event.target.value === '__default__'
                    ? null
                    : effortSchema.parse(event.target.value)
              })
            }
          >
            <option value="__default__">{t('nativeDefault')}</option>
            {efforts.map((effort) => (
              <option key={effort} value={effort}>
                {t(`effort.${effort}`, { defaultValue: effort })}
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
