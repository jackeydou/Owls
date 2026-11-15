import { IconButton } from '@renderer/components/ui/icon-button'
import { MessageStarIcon } from '@renderer/components/ui/icons'
import { useTranslation } from 'react-i18next'
import { FeedbackDialog } from './FeedbackDialog'
import { useFeedbackStore } from './store'
import './feedback.css'

/** The title bar's feedback entry, beside the Projects toggle, and the dialog it opens. */
export function FeedbackButton() {
  const { t } = useTranslation()
  const open = useFeedbackStore((s) => s.open)
  const show = useFeedbackStore((s) => s.show)
  return (
    <>
      <IconButton
        className="owlto-feedback-toggle"
        label={t('feedback.open')}
        tooltip={t('feedback.tooltip')}
        tooltipSide="bottom"
        aria-haspopup="dialog"
        aria-expanded={open}
        icon={<MessageStarIcon size={18} />}
        onClick={show}
      />
      {open ? <FeedbackDialog /> : null}
    </>
  )
}
