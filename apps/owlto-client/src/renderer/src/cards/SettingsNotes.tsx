import { ActionButton } from '@renderer/components/ui/action-button'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { failureMessage } from '../app/failures'
import { SettingRow } from '../app/SettingRow'
import { useNotesStorageStore } from './storage'

/** Where notes live: this Mac, or iCloud so the user's other devices have them too. */
export function NotesSettingsPane() {
  const { t } = useTranslation()
  const storage = useNotesStorageStore((s) => s.storage)
  const pending = useNotesStorageStore((s) => s.pending)
  const error = useNotesStorageStore((s) => s.error)
  const load = useNotesStorageStore((s) => s.load)
  const setLocation = useNotesStorageStore((s) => s.setLocation)
  useEffect(() => {
    void load()
  }, [load])
  const inICloud = storage?.location === 'icloud'
  const unavailable = storage?.icloud.status === 'unavailable' ? storage.icloud.reason : null
  return (
    <section className="owlto-settings-section">
      <h2>{t('cards.title')}</h2>
      <p>{t('notesStorage.body')}</p>
      <SettingRow
        label={t('notesStorage.icloud')}
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
        <ActionButton
          size="sm"
          variant={inICloud ? 'ghost' : 'outline'}
          disabled={!storage || (!inICloud && unavailable !== null)}
          doneLabel={inICloud ? t('notesStorage.turnedOff') : t('notesStorage.turnedOn')}
          onAction={async () =>
            (await setLocation(inICloud ? 'local' : 'icloud')) ? 'done' : 'quiet'
          }
        >
          {inICloud ? t('notesStorage.turnOff') : t('notesStorage.turnOn')}
        </ActionButton>
      </SettingRow>
    </section>
  )
}
