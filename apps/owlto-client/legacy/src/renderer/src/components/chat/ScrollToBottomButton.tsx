import { useI18n } from '@renderer/lib/i18n'
import { ArrowDown } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'

export function ScrollToBottomButton({
  bottom,
  onClick,
  visible
}: {
  bottom: number
  onClick: () => void
  visible: boolean
}): React.JSX.Element {
  const { t } = useI18n()

  return (
    <AnimatePresence>
      {visible ? (
        <motion.button
          type="button"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ duration: 0.15 }}
          onClick={onClick}
          className="absolute left-1/2 z-30 flex size-8 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-card text-foreground/70 transition-colors hover:text-foreground/80"
          aria-label={t('chat.scrollToBottom')}
          style={{ bottom }}
        >
          <ArrowDown className="size-4" strokeWidth={2} />
        </motion.button>
      ) : null}
    </AnimatePresence>
  )
}
