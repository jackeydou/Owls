import { Switch } from '@renderer/components/ui/switch'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { failureMessage } from '../app/failures'
import { SettingRow } from '../app/SettingRow'
import { useNotesStorageStore } from './storage'

/**
 * Experiments → Sync notes with iCloud: where notes live, this Mac or iCloud so the user's
 * other devices have them too. Experimental while iCloud sync is new.
 */
export function NotesICloudSetting() {
  const { t } = useTranslation()
  const storage = useNotesStorageStore((s) => s.storage)
  const pending = useNotesStorageStore((s) => s.pending)
  const error = useNotesStorageStore((s) => s.error)
  const load = useNotesStorageStore((s) => s.load)
  const setLocation = useNotesStorageStore((s) => s.setLocation)
  const [switching, setSwitching] = useState(false)
  useEffect(() => {
    void load()
  }, [load])
  const inICloud = storage?.location === 'icloud'
  const unavailable = storage?.icloud.status === 'unavailable' ? storage.icloud.reason : null
  return (
    <SettingRow
      label={t('notesStorage.icloud')}
      htmlFor="notes-icloud"
      description={inICloud ? t('notesStorage.onHelp') : t('notesStorage.offHelp')}
      detail={
        storage ? (
          <>
            <code className="owlto-path">{storage.folder}</code>
            {unavailable ? (
              <p className="owlto-note" role="status">
                {t(`notesStorage.unavailable.${unavailable}`)}
              </p>
            ) : null}
            {pending > 0 ? (
              <p className="owlto-note" role="status">
                {t('notesStorage.downloading', { count: pending })}
              </p>
            ) : null}
            {error ? (
              <p className="owlto-note" role="alert">
                {failureMessage(error)}
              </p>
            ) : null}
          </>
        ) : null
      }
    >
      <Switch
        id="notes-icloud"
        checked={inICloud}
        disabled={switching || !storage || (!inICloud && unavailable !== null)}
        onCheckedChange={(checked) => {
          setSwitching(true)
          void setLocation(checked ? 'icloud' : 'local').finally(() => setSwitching(false))
        }}
      />
    </SettingRow>
  )
}
