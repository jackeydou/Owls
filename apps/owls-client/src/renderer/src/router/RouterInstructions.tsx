import { ActionButton } from '@renderer/components/ui/action-button'
import { Button } from '@renderer/components/ui/button'
import { Dialog } from '@renderer/components/ui/dialog'
import { CheckIcon, RotateCcwIcon } from '@renderer/components/ui/icons'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ROUTER_INSTRUCTIONS, ROUTER_INSTRUCTIONS_LIMIT } from '../../../shared/router-instructions'
import { SettingRow } from '../app/SettingRow'
import { useAppStore } from '../app/store'

/** Saves the Router's instructions; null goes back to the defaults. True once the save stuck. */
function useInstructionsSaver() {
  const saveSettings = useAppStore((s) => s.saveSettings)
  return async (instructions: string | null): Promise<boolean> => {
    const { settings } = useAppStore.getState()
    await saveSettings({ ...settings, router: { ...settings.router, instructions } })
    return useAppStore.getState().settings.router.instructions === instructions
  }
}

/**
 * The Router's instructions as editable text, starting from the defaults. Text equal to the
 * defaults is saved as "use the defaults", so a later Owls update still reaches the user.
 */
export function RouterInstructionsRow() {
  const { t } = useTranslation()
  const saved = useAppStore((s) => s.settings.router.instructions)
  const current = saved ?? ROUTER_INSTRUCTIONS
  const [draft, setDraft] = useState(current)
  const [confirming, setConfirming] = useState(false)
  const save = useInstructionsSaver()
  const labelId = useId()
  // A save, or a restore, replaces what is shown.
  useEffect(() => setDraft(current), [current])
  const blank = draft.trim() === ''
  const changed = draft !== current
  const custom = saved !== null
  return (
    <SettingRow
      label={t('routerSettings.instructions')}
      labelId={labelId}
      description={t('routerSettings.instructionsHelp')}
      detail={
        <div className="owls-router-instructions">
          <textarea
            className="owls-setting-textarea code"
            aria-labelledby={labelId}
            rows={16}
            spellCheck={false}
            maxLength={ROUTER_INSTRUCTIONS_LIMIT}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="owls-router-instructions-footer">
            <span className="owls-router-instructions-state" role="status">
              {changed
                ? t('routerSettings.instructionsUnsaved')
                : custom
                  ? t('routerSettings.instructionsCustom')
                  : t('routerSettings.instructionsDefault')}
            </span>
            <div className="owls-settings-actions">
              {changed ? (
                <Button size="sm" variant="ghost" onClick={() => setDraft(current)}>
                  {t('routerSettings.instructionsDiscard')}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                disabled={!custom}
                onClick={() => setConfirming(true)}
                aria-haspopup="dialog"
              >
                <RotateCcwIcon size={16} />
                {t('routerSettings.instructionsRestore')}
              </Button>
              <ActionButton
                size="sm"
                icon={<CheckIcon size={16} />}
                disabled={!changed || blank}
                doneLabel={t('routerSettings.instructionsSaved')}
                onAction={async () => {
                  const next = draft.trim() === ROUTER_INSTRUCTIONS.trim() ? null : draft
                  return (await save(next)) ? 'done' : 'quiet'
                }}
              >
                {t('routerSettings.instructionsSave')}
              </ActionButton>
            </div>
          </div>
          {confirming ? (
            <RestoreDialog onClose={() => setConfirming(false)} onRestore={() => save(null)} />
          ) : null}
        </div>
      }
    />
  )
}

function RestoreDialog({
  onClose,
  onRestore
}: {
  onClose: () => void
  onRestore: () => Promise<boolean>
}) {
  const { t } = useTranslation()
  const titleId = useId()
  return (
    <Dialog onClose={onClose} aria-labelledby={titleId} className="owls-settings-dialog">
      <h2 id={titleId}>{t('routerSettings.instructionsRestoreTitle')}</h2>
      <p>{t('routerSettings.instructionsRestoreBody')}</p>
      <footer>
        <Button size="sm" variant="ghost" onClick={onClose}>
          {t('routerSettings.instructionsCancel')}
        </Button>
        <ActionButton
          size="sm"
          variant="destructive"
          onAction={async () => {
            // The dialog closes on success; the restored text in the field is the result.
            if (await onRestore()) onClose()
            return 'quiet'
          }}
        >
          {t('routerSettings.instructionsRestoreConfirm')}
        </ActionButton>
      </footer>
    </Dialog>
  )
}
