import type { Choice } from '@renderer/components/ui/choice-select'
import { AlertCircleIcon, FileIcon, ShieldCheckIcon } from '@renderer/components/ui/icons'
import type { TFunction } from 'i18next'
import type { Permission } from '../../../shared/agents'

/** The permission levels as rich choices: icon, name, and what each one allows. */
export function permissionChoices(t: TFunction): Choice<Permission>[] {
  return [
    {
      value: 'read-only',
      label: t('permission.read-only'),
      description: t('permissionChoice.read-only'),
      icon: FileIcon
    },
    {
      value: 'workspace-write',
      label: t('permission.workspace-write'),
      description: t('permissionChoice.workspace-write'),
      icon: ShieldCheckIcon
    },
    {
      value: 'full-access',
      label: t('permission.full-access'),
      description: t('permissionChoice.full-access'),
      icon: AlertCircleIcon,
      tone: 'danger'
    }
  ]
}
