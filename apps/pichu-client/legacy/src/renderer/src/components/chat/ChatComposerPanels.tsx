import { ChatComposer } from '@renderer/components/chat/ChatComposer'
import { EmptyChatLogo } from '@renderer/components/chat/EmptyChatLogo'
import { ProjectWorkSelector } from '@renderer/components/chat/ProjectWorkSelector'
import { useI18n } from '@renderer/lib/i18n'
import { motion } from 'motion/react'
import type { ComponentProps, RefObject } from 'react'
import type { ProjectEntry } from '../../../../preload/index.d'

type ChatComposerProps = ComponentProps<typeof ChatComposer>
type ComposerProps = Pick<
  ChatComposerProps,
  | 'busy'
  | 'currentModelId'
  | 'currentThinkingLevel'
  | 'followUpBehavior'
  | 'onCancel'
  | 'onModelChange'
  | 'onSend'
  | 'onSteer'
  | 'onThinkingLevelChange'
  | 'onOpenSideChat'
  | 'placeholder'
  | 'ready'
  | 'sessionId'
  | 'showModelSwitcher'
>

export function CenteredChatStart({
  composer,
  currentProject,
  emptyChatTitle,
  loaded,
  onAddProject,
  onSelectProject,
  onWorkLocally,
  projects,
  reduceMotion
}: {
  composer: ComposerProps
  currentProject: ProjectEntry | null
  emptyChatTitle: string
  loaded: boolean
  onAddProject: () => void
  onSelectProject: (project: ProjectEntry) => void
  onWorkLocally: () => void
  projects: ProjectEntry[]
  reduceMotion: boolean
}): React.JSX.Element {
  const { t } = useI18n()

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="w-full max-w-[var(--pichu-composer-max-width)] pb-40"
    >
      <EmptyChatLogo />
      <h1 className="mb-8 text-center text-[30px] font-normal text-foreground">{emptyChatTitle}</h1>
      <label className="sr-only" htmlFor="chat-input">
        {t('chat.messageLabel')}
      </label>
      <ChatComposer
        id="chat-input"
        {...composer}
        footer={
          <div className="-mt-4 rounded-b-[24px] bg-card-muted/75 px-4 pt-6 pb-2">
            <ProjectWorkSelector
              projects={projects}
              currentProject={currentProject}
              disabled={!loaded}
              onSelectProject={onSelectProject}
              onAddProject={onAddProject}
              onWorkLocally={onWorkLocally}
            />
          </div>
        }
      />
    </motion.div>
  )
}

export function SetupEmptyState({ reduceMotion }: { reduceMotion: boolean }): React.JSX.Element {
  const { t } = useI18n()

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col items-center justify-center py-16"
    >
      <h2 className="mb-1.5 text-[18px] font-semibold tracking-tight text-foreground">
        {t('chat.welcome.title')}
      </h2>
      <p className="max-w-xs text-center text-[13.5px] leading-relaxed text-muted-foreground">
        {t('chat.welcome.configurePrefix')}{' '}
        <span className="font-medium text-foreground/70">{t('nav.settings')}</span>{' '}
        {t('chat.welcome.configureSuffix')}
      </p>
    </motion.div>
  )
}

export function BottomChatComposer({
  composer,
  composerContentRef,
  onRemoveQueuedPrompt,
  onReorderQueuedPrompts,
  onSteerQueuedPrompt,
  onSteerQueuedPrompts,
  queuedPrompts
}: {
  composer: ComposerProps
  composerContentRef: RefObject<HTMLDivElement | null>
  onRemoveQueuedPrompt: (id: string) => void
  onReorderQueuedPrompts: (ids: string[]) => void
  onSteerQueuedPrompt: (id: string) => void
  onSteerQueuedPrompts: (ids: string[]) => void
  queuedPrompts: ChatComposerProps['queuedPrompts']
}): React.JSX.Element {
  const { t } = useI18n()

  return (
    <div className="chat-composer-fade pointer-events-none sticky bottom-0 z-40 -mx-5 mt-auto px-5 pt-12 pb-4">
      <div
        ref={composerContentRef}
        className="pointer-events-auto mx-auto w-full max-w-[var(--pichu-composer-max-width)]"
      >
        <label className="sr-only" htmlFor="chat-input">
          {t('chat.messageLabel')}
        </label>
        <ChatComposer
          id="chat-input"
          {...composer}
          queuedPrompts={queuedPrompts}
          onSteerQueuedPrompt={onSteerQueuedPrompt}
          onSteerQueuedPrompts={onSteerQueuedPrompts}
          onRemoveQueuedPrompt={onRemoveQueuedPrompt}
          onReorderQueuedPrompts={onReorderQueuedPrompts}
        />
      </div>
    </div>
  )
}
