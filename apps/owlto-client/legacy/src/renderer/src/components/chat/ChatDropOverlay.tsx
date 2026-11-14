import { useI18n } from '@renderer/lib/i18n'
import { AnimatePresence, motion } from 'motion/react'

export function ChatDropOverlay({
  active,
  reduceMotion
}: {
  active: boolean
  reduceMotion: boolean
}): React.JSX.Element {
  const { t } = useI18n()

  return (
    <AnimatePresence>
      {active ? (
        <motion.div
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduceMotion ? undefined : { opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-sky-400/12 backdrop-blur-[1px]"
        >
          <div className="rounded-lg border border-border/70 bg-background/90 px-3 py-1.5 text-[12px] font-medium text-foreground shadow-md">
            {t('chat.attachment.dropToAttach')}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
