import { ToolApprovalMessage } from '@renderer/components/ToolApprovalMessage'
import { IconButton } from '@renderer/components/ui/icon-button'
import { Toast, ToastViewport } from '@renderer/components/ui/toast'
import { useI18n } from '@renderer/lib/i18n'
import { usePluginStore } from '@renderer/stores/plugin-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { useToolApprovalStore } from '@renderer/stores/tool-approval-store'
import { type Editor, Extension, type JSONContent } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { ArrowUp } from 'lucide-react'
import { Plugin, PluginKey } from 'prosemirror-state'
import type { ReactNode } from 'react'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
  InstalledPlugin,
  MessageAttachment,
  PluginMarketplaceRefreshSource,
  SkillListResult,
  SkillSummary
} from '../../../../preload/index.d'
import type { PichuReasoningMenuLevel, PichuThinkingLevel } from '../../../../shared/model-settings'
import type { AgentTrustProfile } from '../../../../shared/tool-approval'
import { ApprovalProfileMenu } from './ApprovalProfileMenu'
import { ComposerAddMenu } from './ComposerAddMenu'
import { ComposerContextAttachments } from './ComposerContextAttachments'
import { ComposerPluginInstallPrompt } from './ComposerPluginInstallPrompt'
import { ComposerQueuedPrompts } from './ComposerQueuedPrompts'
import { ContextMentionPopup } from './ContextMentionPopup'
import { ContextUsageIndicator } from './ContextUsageIndicator'
import type {
  AddChatArtifactEventDetail,
  AddChatCommentEventDetail,
  AddChatTextEventDetail,
  ArtifactContext,
  CommentAttachmentContext,
  ComposerQueuedPrompt,
  ComposerSubmitOptions,
  ComposerTrigger,
  FocusChatComposerEventDetail,
  PluginInstallPrompt,
  SelectionContext,
  SetChatDraftEventDetail
} from './chat-composer-types'
import {
  buildPluginTags,
  composeMessageParts,
  composePromptWithContexts,
  editorTextBeforeSelection,
  findMentionTrigger,
  findPluginInstallPrompt,
  findSkillTrigger,
  isImeComposing,
  loadRecentPluginIds,
  normalizeCommentAttachmentInput,
  PLUGIN_RECENT_IDS_LIMIT,
  queuedPromptToComposerContent,
  saveRecentPluginIds,
  textMatchesOrderedQuery
} from './chat-composer-utils'
import {
  type AddChatCommentEventPayload,
  COMPOSER_ADD_ARTIFACT_EVENT,
  COMPOSER_ADD_COMMENT_EVENT,
  COMPOSER_ADD_TEXT_EVENT,
  COMPOSER_FOCUS_EVENT,
  COMPOSER_SET_DRAFT_EVENT,
  notifyCommentAttachmentsChanged,
  PENDING_CHAT_ARTIFACTS_STORAGE_KEY,
  PENDING_CHAT_DRAFT_STORAGE_KEY
} from './composer-events'
import {
  buildEditorMessageParts,
  ContextMentionNode,
  contextTagToMentionAttrs,
  extractContextTagsFromEditor,
  extractSkillMentionsFromEditor,
  SkillMentionNode,
  serializeEditorAgentContext,
  serializeEditorContext,
  skillToMentionAttrs,
  WorkspaceLinkNode
} from './context-mention-node'
import type { ComposerContextTag } from './context-tags'
import { ModelSwitcher } from './ModelSwitcher'
import { SkillPickerPopup } from './SkillPickerPopup'
import { useComposerAttachments } from './useComposerAttachments'
import { useComposerCursorOrigin } from './useComposerCursorOrigin'

function isComposerContextTag(value: unknown): value is ComposerContextTag {
  if (!value || typeof value !== 'object') return false
  const tag = value as Partial<ComposerContextTag>
  if (tag.kind === 'plugin') {
    const plugin = tag as Partial<Extract<ComposerContextTag, { kind: 'plugin' }>>
    return (
      typeof plugin.id === 'string' &&
      typeof plugin.name === 'string' &&
      typeof plugin.path === 'string'
    )
  }
  return false
}

function isSetChatDraftEventDetail(value: unknown): value is SetChatDraftEventDetail {
  if (!value || typeof value !== 'object') return false
  const detail = value as Partial<SetChatDraftEventDetail>
  return (
    typeof detail.text === 'string' &&
    (detail.behavior === undefined ||
      detail.behavior === 'replace' ||
      detail.behavior === 'append') &&
    (detail.contextTags === undefined ||
      (Array.isArray(detail.contextTags) && detail.contextTags.every(isComposerContextTag)))
  )
}

function parseAddChatCommentEventPayload(value: AddChatCommentEventPayload): {
  comment: AddChatCommentEventDetail
  target: 'main' | 'side'
} {
  if (value && typeof value === 'object' && 'comment' in value) {
    const target = (value as { target?: unknown }).target === 'side' ? 'side' : 'main'
    return { comment: (value as { comment: AddChatCommentEventDetail }).comment, target }
  }
  return { comment: value as AddChatCommentEventDetail, target: 'main' }
}

function parseSideChatCommand(value: string): string | null {
  const trimmedStart = value.trimStart()
  if (trimmedStart !== '/side' && !trimmedStart.startsWith('/side ')) {
    return null
  }

  return trimmedStart.slice('/side'.length).trimStart()
}

function matchesSideChatCommand(query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase()
  return (
    normalizedQuery.length === 0 ||
    'side'.includes(normalizedQuery) ||
    textMatchesOrderedQuery('side', normalizedQuery)
  )
}

type AgentTrustProfileToast = {
  id: number
  title: string
  description?: string
}

type ComposerDraftSnapshot = {
  text: string
  doc: JSONContent | null
  editorEmpty: boolean
  attachments: MessageAttachment[]
  selectionContexts: SelectionContext[]
  artifactContexts: ArtifactContext[]
  commentAttachments: CommentAttachmentContext[]
}

const NEW_CHAT_DRAFT_KEY = 'new-chat'
const COMPOSER_DRAFT_CACHE_LIMIT = 50
const composerDraftsByKey = new Map<string, ComposerDraftSnapshot>()

function composerDraftKey(composerTarget: 'main' | 'side', sessionId: string | null): string {
  return `${composerTarget}:${sessionId ?? NEW_CHAT_DRAFT_KEY}`
}

function emptyComposerDraftSnapshot(): ComposerDraftSnapshot {
  return {
    text: '',
    doc: null,
    editorEmpty: true,
    attachments: [],
    selectionContexts: [],
    artifactContexts: [],
    commentAttachments: []
  }
}

function hasComposerDraftContent(snapshot: ComposerDraftSnapshot): boolean {
  return (
    !snapshot.editorEmpty ||
    snapshot.text.trim().length > 0 ||
    snapshot.attachments.length > 0 ||
    snapshot.selectionContexts.length > 0 ||
    snapshot.artifactContexts.length > 0 ||
    snapshot.commentAttachments.length > 0
  )
}

function cloneComposerDraftSnapshot(snapshot: ComposerDraftSnapshot): ComposerDraftSnapshot {
  return {
    text: snapshot.text,
    doc: snapshot.doc,
    editorEmpty: snapshot.editorEmpty,
    attachments: [...snapshot.attachments],
    selectionContexts: [...snapshot.selectionContexts],
    artifactContexts: [...snapshot.artifactContexts],
    commentAttachments: [...snapshot.commentAttachments]
  }
}

function saveComposerDraftSnapshot(key: string, snapshot: ComposerDraftSnapshot): void {
  if (!hasComposerDraftContent(snapshot)) {
    composerDraftsByKey.delete(key)
    return
  }

  composerDraftsByKey.delete(key)
  composerDraftsByKey.set(key, cloneComposerDraftSnapshot(snapshot))
  while (composerDraftsByKey.size > COMPOSER_DRAFT_CACHE_LIMIT) {
    const oldestKey = composerDraftsByKey.keys().next().value
    if (typeof oldestKey !== 'string') return
    composerDraftsByKey.delete(oldestKey)
  }
}

function readComposerDraftSnapshot(key: string): ComposerDraftSnapshot | null {
  const snapshot = composerDraftsByKey.get(key)
  if (!snapshot) return null

  composerDraftsByKey.delete(key)
  composerDraftsByKey.set(key, snapshot)
  return snapshot
}

function plainTextToEditorContent(text: string): JSONContent[] {
  return text.split('\n').flatMap((line, index) => {
    const content: JSONContent[] = []
    if (index > 0) content.push({ type: 'hardBreak' })
    if (line) content.push({ type: 'text', text: line })
    return content
  })
}

const PlainTextPasteExtension = Extension.create({
  name: 'pichuPlainTextPaste',

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: new PluginKey('pichuPlainTextPaste'),
        props: {
          handlePaste(_view, event) {
            const text = event.clipboardData?.getData('text/plain') ?? ''
            if (!text) return false

            event.preventDefault()
            editor.chain().focus().insertContent(plainTextToEditorContent(text)).run()
            return true
          }
        }
      })
    ]
  }
})

function ChatComposerBase({
  id,
  composerTarget = 'main',
  ready,
  busy,
  placeholder,
  onSend,
  onSteer,
  followUpBehavior,
  onCancel,
  currentModelId,
  currentThinkingLevel,
  onModelChange,
  onThinkingLevelChange,
  showModelSwitcher,
  sessionId,
  footer,
  queuedPrompts = [],
  onSteerQueuedPrompt,
  onSteerQueuedPrompts,
  onRemoveQueuedPrompt,
  onReorderQueuedPrompts,
  onOpenSideChat
}: {
  id?: string
  composerTarget?: 'main' | 'side'
  ready: boolean
  busy: boolean
  placeholder: string
  onSend: (
    text: string,
    attachments: MessageAttachment[],
    options?: ComposerSubmitOptions
  ) => Promise<void>
  onSteer: (
    text: string,
    attachments: MessageAttachment[],
    options?: ComposerSubmitOptions
  ) => Promise<void>
  followUpBehavior: 'queue' | 'steer'
  onCancel: () => void
  currentModelId: string
  currentThinkingLevel: PichuThinkingLevel
  onModelChange: (modelId: string, defaultThinkingLevel?: PichuThinkingLevel) => void
  onThinkingLevelChange: (level: PichuReasoningMenuLevel) => void
  showModelSwitcher?: boolean
  sessionId: string | null
  footer?: ReactNode
  queuedPrompts?: ComposerQueuedPrompt[]
  onSteerQueuedPrompt?: (id: string) => void
  onSteerQueuedPrompts?: (ids: string[]) => void
  onRemoveQueuedPrompt?: (id: string) => void
  onReorderQueuedPrompts?: (ids: string[]) => void
  onOpenSideChat?: (initialText?: string, options?: { focusComposer?: boolean }) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const updateFollowUpBehavior = useSettingsStore((state) => state.updateFollowUpBehavior)
  const agentTrustProfile = useSettingsStore((state) => state.agentTrustProfile)
  const updateAgentTrustProfile = useSettingsStore((state) => state.updateAgentTrustProfile)
  const approvalRequests = useToolApprovalStore((state) => state.requests)
  const loadApprovals = useToolApprovalStore((state) => state.load)
  const attachApprovalListeners = useToolApprovalStore((state) => state.attachListeners)
  const [input, setInput] = useState('')
  const [editorJson, setEditorJson] = useState<JSONContent | null>(null)
  const [editorEmpty, setEditorEmpty] = useState(true)
  const [selectionContexts, setSelectionContexts] = useState<SelectionContext[]>([])
  const [artifactContexts, setArtifactContexts] = useState<ArtifactContext[]>([])
  const [commentAttachments, setCommentAttachments] = useState<CommentAttachmentContext[]>([])
  const [confirmRemoveQueuedPromptId, setConfirmRemoveQueuedPromptId] = useState<string | null>(
    null
  )
  const [stopConfirmArmed, setStopConfirmArmed] = useState(false)
  const [skillsResult, setSkillsResult] = useState<SkillListResult>({ skills: [], diagnostics: [] })
  const [skillsLoading, setSkillsLoading] = useState(false)
  const installedPlugins = usePluginStore((state) => state.installed)
  const availablePlugins = usePluginStore((state) => state.available)
  const reloadInstalledPlugins = usePluginStore((state) => state.reloadInstalledPlugins)
  const refreshPluginMarketplaces = usePluginStore((state) => state.refreshPluginMarketplaces)
  const [pluginToggleBusyId, setPluginToggleBusyId] = useState<string | null>(null)
  const [pluginPromptBusy, setPluginPromptBusy] = useState(false)
  const [pluginPromptError, setPluginPromptError] = useState<string | null>(null)
  const [dismissedPluginPromptKey, setDismissedPluginPromptKey] = useState<string | null>(null)
  const [agentTrustProfileToast, setAgentTrustProfileToast] =
    useState<AgentTrustProfileToast | null>(null)
  const [recentPluginIds, setRecentPluginIds] = useState<string[]>(() => loadRecentPluginIds())
  const [mentionPluginOrderIds, setMentionPluginOrderIds] = useState<string[] | null>(null)
  const [skillPopupOpen, setSkillPopupOpen] = useState(false)
  const [mentionPopupOpen, setMentionPopupOpen] = useState(false)
  const [activeSkillTrigger, setActiveSkillTrigger] = useState<ComposerTrigger | null>(null)
  const [activeMentionTrigger, setActiveMentionTrigger] = useState<ComposerTrigger | null>(null)
  const [popupDismissed, setPopupDismissed] = useState<'skill' | 'mention' | null>(null)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [composing, setComposing] = useState(false)
  const draftKey = useMemo(
    () => composerDraftKey(composerTarget, sessionId),
    [composerTarget, sessionId]
  )
  const editorShellRef = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(false)
  const skillsRequestIdRef = useRef(0)
  const popupDismissedRef = useRef<'skill' | 'mention' | null>(null)
  const stopConfirmTimeoutRef = useRef<number | null>(null)
  const draftKeyRef = useRef(draftKey)
  const suppressNextDraftSaveRef = useRef(false)
  const inputRef = useRef(input)
  const editorJsonRef = useRef(editorJson)
  const editorEmptyRef = useRef(editorEmpty)
  const attachmentsRef = useRef<MessageAttachment[]>([])
  const selectionContextsRef = useRef(selectionContexts)
  const artifactContextsRef = useRef(artifactContexts)
  const commentAttachmentsRef = useRef(commentAttachments)
  const hasPendingApproval =
    sessionId !== null && approvalRequests.some((request) => request.sessionId === sessionId)

  const currentDraftSnapshot = useCallback(
    (): ComposerDraftSnapshot => ({
      text: inputRef.current,
      doc: editorJsonRef.current,
      editorEmpty: editorEmptyRef.current,
      attachments: attachmentsRef.current,
      selectionContexts: selectionContextsRef.current,
      artifactContexts: artifactContextsRef.current,
      commentAttachments: commentAttachmentsRef.current
    }),
    []
  )

  const saveCurrentDraftSnapshot = useCallback(
    (key = draftKeyRef.current): void => {
      saveComposerDraftSnapshot(key, currentDraftSnapshot())
    },
    [currentDraftSnapshot]
  )

  const updateDraftRefs = useCallback((snapshot: ComposerDraftSnapshot): void => {
    inputRef.current = snapshot.text
    editorJsonRef.current = snapshot.doc
    editorEmptyRef.current = snapshot.editorEmpty
    attachmentsRef.current = snapshot.attachments
    selectionContextsRef.current = snapshot.selectionContexts
    artifactContextsRef.current = snapshot.artifactContexts
    commentAttachmentsRef.current = snapshot.commentAttachments
  }, [])

  const loadSkills = useCallback(() => {
    const requestId = skillsRequestIdRef.current + 1
    skillsRequestIdRef.current = requestId
    setSkillsLoading(true)

    return window.api.agent
      .listSkills()
      .then((result) => {
        if (!mountedRef.current || requestId !== skillsRequestIdRef.current) return
        setSkillsResult(result)
      })
      .catch((error) => {
        console.error('Failed to load skills', error)
      })
      .finally(() => {
        if (!mountedRef.current || requestId !== skillsRequestIdRef.current) return
        setSkillsLoading(false)
      })
  }, [])

  const refreshPlugins = useCallback(
    (source: PluginMarketplaceRefreshSource = 'page_load') => {
      return refreshPluginMarketplaces(source).catch(async (error) => {
        console.error('Failed to refresh plugin marketplaces', error)
        await reloadInstalledPlugins().catch((reloadError) => {
          console.error('Failed to reload installed plugins', reloadError)
        })
      })
    },
    [refreshPluginMarketplaces, reloadInstalledPlugins]
  )

  const togglePluginEnabled = useCallback(
    (plugin: InstalledPlugin): void => {
      if (pluginToggleBusyId) return
      setPluginToggleBusyId(plugin.id)

      const action = plugin.enabled
        ? window.api.plugins.disable(plugin.id)
        : window.api.plugins.enable(plugin.id)

      void action
        .then(async () => {
          await Promise.all([refreshPlugins('post_action'), loadSkills()])
        })
        .catch((error) => {
          console.error('Failed to toggle plugin', error)
        })
        .finally(() => {
          if (!mountedRef.current) return
          setPluginToggleBusyId(null)
        })
    },
    [loadSkills, pluginToggleBusyId, refreshPlugins]
  )

  const updateEditorSnapshot = useCallback((nextEditor: Editor): void => {
    setInput(nextEditor.getText())
    setEditorJson(nextEditor.getJSON())
    setEditorEmpty(nextEditor.isEmpty)
    setMentionPopupOpen(false)
    setPopupDismissed(null)
    setHighlightedIndex(0)
    const textBeforeSelection = editorTextBeforeSelection(nextEditor)
    const nextSkillTrigger = findSkillTrigger(textBeforeSelection)
    const nextMentionTrigger = findMentionTrigger(textBeforeSelection)
    setActiveSkillTrigger(nextSkillTrigger)
    setActiveMentionTrigger(nextMentionTrigger)
    setSkillPopupOpen(nextSkillTrigger !== null)
    setMentionPopupOpen(nextMentionTrigger !== null)
  }, [])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        blockquote: false,
        bulletList: false,
        code: false,
        codeBlock: false,
        heading: false,
        horizontalRule: false,
        link: {
          openOnClick: false
        },
        listItem: false,
        orderedList: false
      }),
      ContextMentionNode,
      SkillMentionNode,
      WorkspaceLinkNode,
      PlainTextPasteExtension
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'pichu-composer-editor-content',
        role: 'textbox',
        'aria-label': t('chat.messageLabel'),
        'aria-multiline': 'true'
      }
    },
    onUpdate: ({ editor: nextEditor }) => updateEditorSnapshot(nextEditor),
    onSelectionUpdate: ({ editor: nextEditor }) => {
      const textBeforeSelection = editorTextBeforeSelection(nextEditor)
      const nextSkillTrigger = findSkillTrigger(textBeforeSelection)
      const nextMentionTrigger = findMentionTrigger(textBeforeSelection)
      setActiveSkillTrigger(nextSkillTrigger)
      setActiveMentionTrigger(nextMentionTrigger)
      setSkillPopupOpen(popupDismissedRef.current !== 'skill' && nextSkillTrigger !== null)
      setMentionPopupOpen(popupDismissedRef.current !== 'mention' && nextMentionTrigger !== null)
    },
    immediatelyRender: false
  })

  const focusEditor = useCallback((): void => {
    requestAnimationFrame(() => {
      editor?.commands.focus()
    })
  }, [editor])

  const {
    attachmentError,
    attachments,
    clearAttachmentError,
    clearAttachments,
    handlePickAttachments,
    removeLastAttachment,
    removeAttachment,
    replaceAttachments
  } = useComposerAttachments({ focusEditor })

  const restoreDraftSnapshot = useCallback(
    (snapshot: ComposerDraftSnapshot): void => {
      const nextSnapshot = cloneComposerDraftSnapshot(snapshot)
      updateDraftRefs(nextSnapshot)
      clearAttachmentError()
      replaceAttachments(nextSnapshot.attachments)
      setSelectionContexts(nextSnapshot.selectionContexts)
      setArtifactContexts(nextSnapshot.artifactContexts)
      setCommentAttachments(nextSnapshot.commentAttachments)
      if (nextSnapshot.doc) {
        editor?.commands.setContent(nextSnapshot.doc)
      } else {
        editor?.commands.clearContent()
      }
      setInput(nextSnapshot.text)
      setEditorJson(nextSnapshot.doc)
      setEditorEmpty(nextSnapshot.editorEmpty)
      setActiveSkillTrigger(null)
      setActiveMentionTrigger(null)
      setSkillPopupOpen(false)
      setMentionPopupOpen(false)
      setPopupDismissed(null)
      setHighlightedIndex(0)
    },
    [clearAttachmentError, editor, replaceAttachments, updateDraftRefs]
  )

  useLayoutEffect(() => {
    updateDraftRefs({
      text: input,
      doc: editorJson,
      editorEmpty,
      attachments,
      selectionContexts,
      artifactContexts,
      commentAttachments
    })
  }, [
    artifactContexts,
    attachments,
    commentAttachments,
    editorEmpty,
    editorJson,
    input,
    selectionContexts,
    updateDraftRefs
  ])

  useLayoutEffect(() => {
    if (!editor) return

    const previousDraftKey = draftKeyRef.current
    if (previousDraftKey !== draftKey) {
      saveCurrentDraftSnapshot(previousDraftKey)
    }

    draftKeyRef.current = draftKey
    suppressNextDraftSaveRef.current = true
    restoreDraftSnapshot(readComposerDraftSnapshot(draftKey) ?? emptyComposerDraftSnapshot())
  }, [draftKey, editor, restoreDraftSnapshot, saveCurrentDraftSnapshot])

  useEffect(() => {
    if (suppressNextDraftSaveRef.current) {
      suppressNextDraftSaveRef.current = false
      return
    }

    saveComposerDraftSnapshot(draftKey, {
      text: input,
      doc: editorJson,
      editorEmpty,
      attachments,
      selectionContexts,
      artifactContexts,
      commentAttachments
    })
  }, [
    artifactContexts,
    attachments,
    commentAttachments,
    draftKey,
    editorEmpty,
    editorJson,
    input,
    selectionContexts
  ])

  useEffect(() => {
    return () => saveCurrentDraftSnapshot(draftKeyRef.current)
  }, [saveCurrentDraftSnapshot])

  const applyChatDraft = useCallback(
    (detail: SetChatDraftEventDetail): void => {
      const text = detail.text.trim()
      const inlineContent: JSONContent[] = []
      for (const tag of detail.contextTags ?? []) {
        inlineContent.push({ type: 'contextMention', attrs: contextTagToMentionAttrs(tag) })
        inlineContent.push({ type: 'text', text: ' ' })
      }
      if (text) {
        inlineContent.push({ type: 'text', text })
      }
      if (inlineContent.length === 0 || !editor) return

      if (detail.behavior === 'append') {
        editor.chain().focus().insertContent(inlineContent).run()
        return
      }

      const doc: JSONContent = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: inlineContent
          }
        ]
      }

      clearAttachmentError()
      clearAttachments()
      setSelectionContexts([])
      setArtifactContexts([])
      setCommentAttachments([])
      editor.commands.setContent(doc)
      const nextText = editor.getText()
      updateDraftRefs({
        text: nextText,
        doc,
        editorEmpty: false,
        attachments: [],
        selectionContexts: [],
        artifactContexts: [],
        commentAttachments: []
      })
      setInput(nextText)
      setEditorJson(doc)
      setEditorEmpty(false)
      setActiveSkillTrigger(null)
      setActiveMentionTrigger(null)
      setSkillPopupOpen(false)
      setMentionPopupOpen(false)
      setPopupDismissed(null)
      setHighlightedIndex(0)
      const pluginIds = (detail.contextTags ?? []).flatMap((tag) =>
        tag.kind === 'plugin' ? [tag.id] : []
      )
      if (pluginIds.length > 0) {
        setRecentPluginIds((current) => {
          const next = [...pluginIds, ...current.filter((id) => !pluginIds.includes(id))].slice(
            0,
            PLUGIN_RECENT_IDS_LIMIT
          )
          saveRecentPluginIds(next)
          return next
        })
      }
      focusEditor()
    },
    [clearAttachmentError, clearAttachments, editor, focusEditor, updateDraftRefs]
  )

  useEffect(() => {
    if (!editor) return

    const readPendingDraft = (): void => {
      const raw = window.sessionStorage.getItem(PENDING_CHAT_DRAFT_STORAGE_KEY)
      if (!raw) return
      window.sessionStorage.removeItem(PENDING_CHAT_DRAFT_STORAGE_KEY)
      try {
        const parsed: unknown = JSON.parse(raw)
        if (isSetChatDraftEventDetail(parsed)) {
          applyChatDraft(parsed)
        }
      } catch (error) {
        console.error('Failed to load pending chat draft', error)
      }
    }

    const handleDraftEvent = (event: Event): void => {
      const detail = (event as CustomEvent<SetChatDraftEventDetail>).detail
      if (isSetChatDraftEventDetail(detail)) {
        applyChatDraft(detail)
      }
    }

    readPendingDraft()
    window.addEventListener(COMPOSER_SET_DRAFT_EVENT, handleDraftEvent)
    return () => window.removeEventListener(COMPOSER_SET_DRAFT_EVENT, handleDraftEvent)
  }, [applyChatDraft, editor])

  useEffect(() => {
    mountedRef.current = true
    void loadSkills()
    void refreshPlugins()

    return () => {
      mountedRef.current = false
    }
  }, [loadSkills, refreshPlugins])

  useEffect(() => {
    const detachApprovalListeners = attachApprovalListeners()
    void loadApprovals()
    return detachApprovalListeners
  }, [attachApprovalListeners, loadApprovals])

  useEffect(() => {
    editor?.setEditable(ready)
  }, [editor, ready])

  useEffect(() => {
    const handleExternalText = (event: Event): void => {
      const detail = (event as CustomEvent<AddChatTextEventDetail | null>).detail
      const target = detail && typeof detail === 'object' ? (detail.target ?? 'main') : 'main'
      if (target !== composerTarget) return
      const text = typeof detail === 'string' ? detail : detail?.text
      const trimmed = typeof text === 'string' ? text.trim() : ''
      if (!trimmed) return

      setSelectionContexts((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          text: trimmed,
          sourceMessageId: detail && typeof detail === 'object' ? detail.sourceMessageId : undefined
        }
      ])
      editor?.commands.focus()
    }

    window.addEventListener(COMPOSER_ADD_TEXT_EVENT, handleExternalText)
    return () => window.removeEventListener(COMPOSER_ADD_TEXT_EVENT, handleExternalText)
  }, [composerTarget, editor])

  useEffect(() => {
    const handleFocus = (event: Event): void => {
      const detail = (event as CustomEvent<FocusChatComposerEventDetail>).detail
      const target = detail?.target ?? 'main'
      if (target !== composerTarget) return
      focusEditor()
    }

    window.addEventListener(COMPOSER_FOCUS_EVENT, handleFocus)
    return () => window.removeEventListener(COMPOSER_FOCUS_EVENT, handleFocus)
  }, [composerTarget, focusEditor])

  useEffect(() => {
    const appendArtifacts = (items: ArtifactContext[]): void => {
      if (items.length === 0) return
      setArtifactContexts((current) => {
        const existingIds = new Set(current.map((item) => item.artifactId))
        const nextItems = items.filter((item) => !existingIds.has(item.artifactId))
        return nextItems.length > 0 ? [...current, ...nextItems] : current
      })
      editor?.commands.focus()
    }

    const readPendingArtifacts = (): void => {
      const raw = window.sessionStorage.getItem(PENDING_CHAT_ARTIFACTS_STORAGE_KEY)
      if (!raw) return
      window.sessionStorage.removeItem(PENDING_CHAT_ARTIFACTS_STORAGE_KEY)
      try {
        const parsed = JSON.parse(raw) as unknown
        if (!Array.isArray(parsed)) return
        appendArtifacts(
          parsed.filter((item): item is ArtifactContext => {
            return (
              typeof item === 'object' &&
              item !== null &&
              'artifactId' in item &&
              'title' in item &&
              'body' in item &&
              typeof item.artifactId === 'string' &&
              typeof item.title === 'string' &&
              typeof item.body === 'string'
            )
          })
        )
      } catch (error) {
        console.error('Failed to load pending artifact context', error)
      }
    }

    const handleExternalArtifact = (event: Event): void => {
      const detail = (event as CustomEvent<AddChatArtifactEventDetail>).detail
      appendArtifacts(Array.isArray(detail) ? detail : [detail])
    }

    readPendingArtifacts()
    window.addEventListener(COMPOSER_ADD_ARTIFACT_EVENT, handleExternalArtifact)
    return () => window.removeEventListener(COMPOSER_ADD_ARTIFACT_EVENT, handleExternalArtifact)
  }, [editor])

  useEffect(() => {
    const handleExternalComment = (event: Event): void => {
      const detail = (event as CustomEvent<AddChatCommentEventPayload>).detail
      const { comment: commentDetail, target } = parseAddChatCommentEventPayload(detail)
      if (target !== composerTarget) return
      const comment = normalizeCommentAttachmentInput(commentDetail)
      if (!comment) return
      setCommentAttachments((current) => {
        const existingIds = new Set(current.map((item) => item.commentId))
        return existingIds.has(comment.commentId) ? current : [...current, comment]
      })
      editor?.commands.focus()
    }

    window.addEventListener(COMPOSER_ADD_COMMENT_EVENT, handleExternalComment)
    return () => window.removeEventListener(COMPOSER_ADD_COMMENT_EVENT, handleExternalComment)
  }, [composerTarget, editor])

  useEffect(() => {
    notifyCommentAttachmentsChanged(commentAttachments, composerTarget)
  }, [commentAttachments, composerTarget])

  useEffect(() => {
    return () => notifyCommentAttachmentsChanged([], composerTarget)
  }, [composerTarget])

  useEffect(() => {
    popupDismissedRef.current = popupDismissed
  }, [popupDismissed])

  useComposerCursorOrigin(editorShellRef)

  const skillTrigger = activeSkillTrigger
  const skillQuery = skillTrigger?.query ?? ''
  const mentionTrigger = activeMentionTrigger
  const mentionQuery = mentionTrigger?.query ?? ''
  const contextTags = useMemo(() => extractContextTagsFromEditor(editorJson), [editorJson])
  const selectedSkills = useMemo(() => extractSkillMentionsFromEditor(editorJson), [editorJson])
  const selectedSkillNames = useMemo(
    () => new Set(selectedSkills.map((skill) => skill.qualifiedName ?? skill.name)),
    [selectedSkills]
  )
  const sideChatCommandEnabled = Boolean(onOpenSideChat)

  const filteredSkills = useMemo(() => {
    return skillsResult.skills.filter((skill) => {
      if (selectedSkillNames.has(skill.qualifiedName ?? skill.name)) {
        return false
      }
      if (!skillQuery) return true
      const name = skill.name.toLowerCase()
      return name.includes(skillQuery) || textMatchesOrderedQuery(name, skillQuery)
    })
  }, [selectedSkillNames, skillQuery, skillsResult.skills])
  const showSideChatCommand = sideChatCommandEnabled && matchesSideChatCommand(skillQuery)
  const sideChatCommandDescription = sideChatCommandEnabled
    ? t('chat.sideCommand.description')
    : composerTarget === 'side'
      ? t('chat.sideCommand.unavailableInSideChat')
      : t('chat.sideCommand.unavailableWithoutMainChat')
  const skillPickerItemCount = filteredSkills.length + (showSideChatCommand ? 1 : 0)

  const pluginTags = useMemo(() => {
    return buildPluginTags({
      contextTags,
      installedPlugins,
      mentionPluginOrderIds,
      mentionQuery,
      recentPluginIds
    })
  }, [contextTags, installedPlugins, mentionPluginOrderIds, mentionQuery, recentPluginIds])

  const pluginInstallPrompt = useMemo(() => {
    return findPluginInstallPrompt({
      text: input,
      available: availablePlugins,
      installed: installedPlugins
    })
  }, [availablePlugins, input, installedPlugins])
  const visiblePluginInstallPrompt =
    pluginInstallPrompt && pluginInstallPrompt.key !== dismissedPluginPromptKey
      ? pluginInstallPrompt
      : null

  const visiblePluginTags = pluginTags
  const mentionItemCount = visiblePluginTags.length
  const serializedPrompt = useMemo(() => serializeEditorContext(editorJson), [editorJson])
  const serializedAgentPrompt = useMemo(() => serializeEditorAgentContext(editorJson), [editorJson])
  const editorMessageParts = useMemo(() => buildEditorMessageParts(editorJson), [editorJson])
  const canSubmit =
    (Boolean(serializedPrompt) ||
      attachments.length > 0 ||
      selectionContexts.length > 0 ||
      artifactContexts.length > 0 ||
      commentAttachments.length > 0) &&
    ready
  const showStopButton = busy && (!canSubmit || stopConfirmArmed)

  useEffect(() => {
    setSkillPopupOpen(popupDismissed !== 'skill' && skillTrigger !== null)
    const nextMentionPopupOpen = popupDismissed !== 'mention' && mentionTrigger !== null
    setMentionPopupOpen(nextMentionPopupOpen)
    if (!nextMentionPopupOpen) {
      setMentionPluginOrderIds(null)
    }
  }, [mentionTrigger, popupDismissed, skillTrigger])

  useEffect(() => {
    if (!mentionPopupOpen) return
    setMentionPluginOrderIds((current) => current ?? pluginTags.map((tag) => tag.id))
  }, [mentionPopupOpen, pluginTags])

  useEffect(() => {
    if (skillPopupOpen) {
      void loadSkills()
    }
  }, [loadSkills, skillPopupOpen])

  useEffect(() => {
    if (mentionPopupOpen) {
      void refreshPlugins()
    }
  }, [mentionPopupOpen, refreshPlugins])

  useEffect(() => {
    if (!pluginInstallPrompt || pluginInstallPrompt.key !== dismissedPluginPromptKey) {
      setPluginPromptError(null)
    }
  }, [dismissedPluginPromptKey, pluginInstallPrompt])

  const handlePluginPromptAction = useCallback(
    (prompt: PluginInstallPrompt): void => {
      if (pluginPromptBusy) return

      setPluginPromptBusy(true)
      setPluginPromptError(null)
      const action =
        prompt.action === 'install'
          ? window.api.plugins.install({
              marketplaceName: prompt.entry.marketplaceName,
              pluginName: prompt.entry.name
            })
          : prompt.installed
            ? window.api.plugins.upgrade(prompt.installed.id)
            : Promise.reject(new Error(`Installed plugin not found: ${prompt.entry.name}`))

      void action
        .then(async () => {
          await Promise.all([refreshPlugins('post_action'), loadSkills()])
        })
        .catch((error) => {
          if (!mountedRef.current) return
          setPluginPromptError(error instanceof Error ? error.message : String(error))
        })
        .finally(() => {
          if (!mountedRef.current) return
          setPluginPromptBusy(false)
        })
    },
    [loadSkills, pluginPromptBusy, refreshPlugins]
  )

  const hasContextChips = selectedSkills.length > 0 || contextTags.length > 0
  const showPlaceholder = !hasContextChips && editorEmpty && placeholder.length > 0

  const stopCurrentResponse = useCallback(
    (_trigger: 'button' | 'keyboard'): void => {
      setStopConfirmArmed(false)
      onCancel()
    },
    [onCancel]
  )

  const handleAgentTrustProfileChange = useCallback(
    (profile: AgentTrustProfile): void => {
      void updateAgentTrustProfile(profile)
        .then(() => {})
        .catch((error) => {
          if (!mountedRef.current) return
          console.error('Failed to update agent trust profile', error)
          setAgentTrustProfileToast({
            id: Date.now(),
            title: t('approvalProfile.updateFailed.title'),
            description: t('approvalProfile.updateFailed.description')
          })
        })
    },
    [t, updateAgentTrustProfile]
  )

  useEffect(() => {
    if (!agentTrustProfileToast) return
    const timeout = window.setTimeout(() => setAgentTrustProfileToast(null), 3600)
    return () => window.clearTimeout(timeout)
  }, [agentTrustProfileToast])

  const requestStopCurrentResponse = useCallback(
    (trigger: 'button' | 'keyboard'): void => {
      if (trigger === 'button') {
        stopCurrentResponse(trigger)
        return
      }
      if (!stopConfirmArmed) {
        setStopConfirmArmed(true)
        return
      }
      stopCurrentResponse(trigger)
    },
    [stopConfirmArmed, stopCurrentResponse]
  )

  useEffect(() => {
    if (!busy) {
      setStopConfirmArmed(false)
    }
  }, [busy])

  useEffect(() => {
    if (!stopConfirmArmed || !busy) return

    stopConfirmTimeoutRef.current = window.setTimeout(() => {
      setStopConfirmArmed(false)
      stopConfirmTimeoutRef.current = null
    }, 2000)

    return () => {
      if (stopConfirmTimeoutRef.current !== null) {
        window.clearTimeout(stopConfirmTimeoutRef.current)
        stopConfirmTimeoutRef.current = null
      }
    }
  }, [busy, stopConfirmArmed])

  useEffect(() => {
    if (!busy) return

    const handleWindowKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || skillPopupOpen || mentionPopupOpen) return
      event.preventDefault()
      requestStopCurrentResponse('keyboard')
    }

    window.addEventListener('keydown', handleWindowKeyDown)
    return () => window.removeEventListener('keydown', handleWindowKeyDown)
  }, [busy, mentionPopupOpen, requestStopCurrentResponse, skillPopupOpen])

  useEffect(() => {
    if (
      confirmRemoveQueuedPromptId &&
      !queuedPrompts.some((prompt) => prompt.id === confirmRemoveQueuedPromptId)
    ) {
      setConfirmRemoveQueuedPromptId(null)
    }
  }, [confirmRemoveQueuedPromptId, queuedPrompts])

  const editQueuedPrompt = useCallback(
    (prompt: ComposerQueuedPrompt): void => {
      const restored = queuedPromptToComposerContent(prompt)
      const nextAttachments = prompt.attachments ?? []
      const nextEditorEmpty =
        !prompt.text.trim() &&
        !prompt.parts?.some(
          (part) =>
            part.type !== 'selectionContext' &&
            part.type !== 'artifactContext' &&
            part.type !== 'comment'
        )
      replaceAttachments(nextAttachments)
      setSelectionContexts(restored.selectionContexts)
      setArtifactContexts(restored.artifactContexts)
      setCommentAttachments(restored.commentAttachments)
      clearAttachmentError()
      editor?.commands.setContent(restored.doc)
      setEditorJson(restored.doc)
      setEditorEmpty(nextEditorEmpty)
      setInput(prompt.text)
      updateDraftRefs({
        text: prompt.text,
        doc: restored.doc,
        editorEmpty: nextEditorEmpty,
        attachments: nextAttachments,
        selectionContexts: restored.selectionContexts,
        artifactContexts: restored.artifactContexts,
        commentAttachments: restored.commentAttachments
      })
      setConfirmRemoveQueuedPromptId(null)
      onRemoveQueuedPrompt?.(prompt.id)
      focusEditor()
    },
    [
      clearAttachmentError,
      editor,
      focusEditor,
      onRemoveQueuedPrompt,
      replaceAttachments,
      updateDraftRefs
    ]
  )

  const requestRemoveQueuedPrompt = useCallback((id: string): void => {
    setConfirmRemoveQueuedPromptId(id)
  }, [])

  const confirmRemoveQueuedPrompt = useCallback(
    (id: string): void => {
      setConfirmRemoveQueuedPromptId(null)
      onRemoveQueuedPrompt?.(id)
    },
    [onRemoveQueuedPrompt]
  )

  function selectSkill(skill: SkillSummary): void {
    if (editor) {
      const trigger = findSkillTrigger(editorTextBeforeSelection(editor)) ?? activeSkillTrigger
      if (trigger) {
        const triggerLength = trigger.end - trigger.start
        const to = editor.state.selection.from
        const from = Math.max(to - triggerLength, 0)
        editor
          .chain()
          .focus()
          .deleteRange({ from, to })
          .insertContent([
            { type: 'skillMention', attrs: skillToMentionAttrs(skill) },
            { type: 'text', text: ' ' }
          ])
          .run()
      } else {
        editor
          .chain()
          .focus()
          .insertContent([
            { type: 'skillMention', attrs: skillToMentionAttrs(skill) },
            { type: 'text', text: ' ' }
          ])
          .run()
      }
    }
    setActiveSkillTrigger(null)
    setSkillPopupOpen(false)
    setPopupDismissed(null)
    setHighlightedIndex(0)
    focusEditor()
  }

  function selectSideChatCommand(): void {
    if (!onOpenSideChat) return
    clearPrompt()
    onOpenSideChat('', { focusComposer: true })
  }

  function selectContextTag(tag: ComposerContextTag): void {
    if (tag.kind === 'plugin' && tag.enabled === false) {
      return
    }
    if (tag.kind === 'plugin') {
      setRecentPluginIds((current) => {
        const next = [tag.id, ...current.filter((id) => id !== tag.id)].slice(
          0,
          PLUGIN_RECENT_IDS_LIMIT
        )
        saveRecentPluginIds(next)
        return next
      })
    }
    if (editor) {
      const trigger = findMentionTrigger(editorTextBeforeSelection(editor))
      const triggerLength = trigger ? trigger.end - trigger.start : 0
      const to = editor.state.selection.from
      const from = Math.max(to - triggerLength, 0)
      editor
        .chain()
        .focus()
        .deleteRange({ from, to })
        .insertContent([
          { type: 'contextMention', attrs: contextTagToMentionAttrs(tag) },
          { type: 'text', text: ' ' }
        ])
        .run()
    }
    setMentionPopupOpen(false)
    setPopupDismissed(null)
    setHighlightedIndex(0)
    focusEditor()
  }

  function clearPrompt(): void {
    const emptySnapshot = emptyComposerDraftSnapshot()
    updateDraftRefs(emptySnapshot)
    composerDraftsByKey.delete(draftKeyRef.current)
    clearAttachments()
    setSelectionContexts([])
    setArtifactContexts([])
    setCommentAttachments([])
    editor?.commands.clearContent()
    setInput('')
    setEditorJson(null)
    setEditorEmpty(true)
    setActiveSkillTrigger(null)
    setActiveMentionTrigger(null)
    setSkillPopupOpen(false)
    setMentionPopupOpen(false)
    setPopupDismissed(null)
    setHighlightedIndex(0)
  }

  function handleSubmit(_trigger: 'button' | 'keyboard' = 'button', shortcutSteer = false): void {
    const submittedDisplayPrompt = serializedPrompt.trim()
    const sideChatPrompt = parseSideChatCommand(submittedDisplayPrompt)
    if (sideChatPrompt !== null && onOpenSideChat) {
      clearPrompt()
      onOpenSideChat(sideChatPrompt, { focusComposer: sideChatPrompt.length === 0 })
      return
    }

    const agentPrompt = composePromptWithContexts(
      serializedAgentPrompt,
      selectionContexts,
      artifactContexts,
      commentAttachments
    )
    const messageParts = composeMessageParts(
      editorMessageParts,
      selectionContexts,
      artifactContexts,
      commentAttachments
    )
    const hasSkillPart = messageParts.some((part) => part.type === 'skill')
    if ((!agentPrompt && attachments.length === 0 && !hasSkillPart) || !ready) return

    const steerFollowUp = busy && (shortcutSteer || followUpBehavior === 'steer')
    const submittedAttachments = attachments
    clearPrompt()
    void (steerFollowUp
      ? onSteer(submittedDisplayPrompt, submittedAttachments, {
          agentText: agentPrompt,
          parts: messageParts
        })
      : onSend(submittedDisplayPrompt, submittedAttachments, {
          agentText: agentPrompt,
          parts: messageParts
        }))
  }

  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (isImeComposing(event, composing)) {
      return
    }

    if (skillPopupOpen && skillPickerItemCount > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        event.stopPropagation()
        setHighlightedIndex((current) => (current + 1) % skillPickerItemCount)
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        event.stopPropagation()
        setHighlightedIndex((current) => (current === 0 ? skillPickerItemCount - 1 : current - 1))
        return
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        event.stopPropagation()
        if (showSideChatCommand && highlightedIndex === 0) {
          selectSideChatCommand()
          return
        }
        const skillIndex = showSideChatCommand ? highlightedIndex - 1 : highlightedIndex
        const selectedSkill = filteredSkills[skillIndex] ?? filteredSkills[0]
        if (selectedSkill) {
          selectSkill(selectedSkill)
        }
        return
      }
    }

    if (mentionPopupOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        event.stopPropagation()
        if (mentionItemCount > 0) {
          setHighlightedIndex((current) => (current + 1) % mentionItemCount)
        }
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        event.stopPropagation()
        if (mentionItemCount > 0) {
          setHighlightedIndex((current) => (current === 0 ? mentionItemCount - 1 : current - 1))
        }
        return
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        event.stopPropagation()
        if (mentionItemCount === 0) {
          setMentionPopupOpen(false)
          setPopupDismissed('mention')
          return
        }
        const selectedIndex = Math.min(highlightedIndex, mentionItemCount - 1)
        const selected = visiblePluginTags[selectedIndex]
        if (selected) {
          if (selected.kind === 'plugin' && selected.enabled === false) {
            const plugin = installedPlugins.find((entry) => entry.id === selected.id)
            if (plugin) {
              togglePluginEnabled(plugin)
            }
            return
          }
          selectContextTag(selected)
        }
        return
      }
    }

    if (event.key === 'Escape' && (skillPopupOpen || mentionPopupOpen)) {
      event.preventDefault()
      event.stopPropagation()
      setSkillPopupOpen(false)
      setMentionPopupOpen(false)
      setPopupDismissed(skillPopupOpen ? 'skill' : 'mention')
      return
    }

    if (event.key === 'Escape' && busy) {
      event.preventDefault()
      event.stopPropagation()
      requestStopCurrentResponse('keyboard')
      return
    }

    if (event.key === 'Backspace' && editorEmpty) {
      event.preventDefault()
      event.stopPropagation()
      if (selectionContexts.length > 0) {
        setSelectionContexts((current) => current.slice(0, -1))
      } else if (artifactContexts.length > 0) {
        setArtifactContexts((current) => current.slice(0, -1))
      } else if (commentAttachments.length > 0) {
        setCommentAttachments((current) => current.slice(0, -1))
      } else if (attachments.length > 0) {
        removeLastAttachment()
      }
      setPopupDismissed(null)
      return
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      event.stopPropagation()
      if (
        event.metaKey &&
        busy &&
        editorEmpty &&
        attachments.length === 0 &&
        selectionContexts.length === 0 &&
        artifactContexts.length === 0 &&
        commentAttachments.length === 0 &&
        queuedPrompts.length > 0
      ) {
        onSteerQueuedPrompts?.(queuedPrompts.map((prompt) => prompt.id))
        return
      }
      handleSubmit('keyboard', event.metaKey)
    }
  }

  function handleComposerDoubleClick(event: React.MouseEvent<HTMLDivElement>): void {
    if (!editor || !ready) return

    event.preventDefault()
    editor.chain().focus().selectAll().run()
  }

  if (hasPendingApproval) {
    return (
      <div className="relative">
        <ToolApprovalMessage sessionId={sessionId ?? null} />
        {footer}
      </div>
    )
  }

  return (
    <div className="relative">
      <SkillPickerPopup
        open={skillPopupOpen}
        sideChatCommandDescription={sideChatCommandDescription}
        sideChatCommandEnabled={sideChatCommandEnabled}
        showSideChatCommand={showSideChatCommand}
        skills={filteredSkills}
        highlightedIndex={Math.min(highlightedIndex, Math.max(skillPickerItemCount - 1, 0))}
        loading={skillsLoading}
        query={skillQuery}
        onHighlight={setHighlightedIndex}
        onSelectSideChatCommand={selectSideChatCommand}
        onSelect={selectSkill}
      />
      <ContextMentionPopup
        open={mentionPopupOpen}
        pluginTags={visiblePluginTags}
        highlightedIndex={Math.min(highlightedIndex, Math.max(mentionItemCount - 1, 0))}
        onHighlight={setHighlightedIndex}
        onTogglePlugin={(tag) => {
          const plugin = installedPlugins.find((entry) => entry.id === tag.id)
          if (plugin) {
            togglePluginEnabled(plugin)
          }
        }}
        pluginToggleBusyId={pluginToggleBusyId}
        onSelect={selectContextTag}
      />

      {queuedPrompts.length > 0 ? (
        <ComposerQueuedPrompts
          prompts={queuedPrompts}
          confirmRemovePromptId={confirmRemoveQueuedPromptId}
          onEdit={editQueuedPrompt}
          onRequestRemove={requestRemoveQueuedPrompt}
          onConfirmRemove={confirmRemoveQueuedPrompt}
          onSteer={(id) => onSteerQueuedPrompt?.(id)}
          followUpBehavior={followUpBehavior}
          onFollowUpBehaviorChange={updateFollowUpBehavior}
          onReorder={onReorderQueuedPrompts}
          onRemoveConfirmState={() => setConfirmRemoveQueuedPromptId(null)}
        />
      ) : null}

      {visiblePluginInstallPrompt ? (
        <ComposerPluginInstallPrompt
          prompt={visiblePluginInstallPrompt}
          busy={pluginPromptBusy}
          error={pluginPromptError}
          onAction={handlePluginPromptAction}
          onDismiss={setDismissedPluginPromptKey}
        />
      ) : null}

      <div className="relative z-10 overflow-visible rounded-(--pichu-composer-radius) bg-card/90 shadow-(--pichu-composer-shadow) ring ring-black/[0.07] backdrop-blur-lg dark:bg-codex-gray-750">
        <ComposerContextAttachments
          selectionContexts={selectionContexts}
          artifactContexts={artifactContexts}
          commentAttachments={commentAttachments}
          attachments={attachments}
          attachmentError={attachmentError}
          composerTarget={composerTarget}
          onRemoveSelection={(selectionId) =>
            setSelectionContexts((current) => current.filter((item) => item.id !== selectionId))
          }
          onRemoveArtifact={(artifactId) =>
            setArtifactContexts((current) => current.filter((item) => item.id !== artifactId))
          }
          onRemoveComment={(commentId) =>
            setCommentAttachments((current) =>
              current.filter((item) => item.commentId !== commentId)
            )
          }
          onRemoveAttachment={removeAttachment}
        />
        <div className="relative flex min-h-[58px] flex-wrap items-start gap-x-1.5 gap-y-1.5 px-4 pt-3 pb-0.5">
          {showPlaceholder ? (
            <div
              className="pointer-events-none absolute left-4 right-4 top-3 overflow-hidden text-muted-foreground/80"
              style={{
                fontSize: 'var(--pichu-composer-font-size)',
                lineHeight: 'var(--pichu-composer-line-height)'
              }}
            >
              <span className="block truncate">{placeholder}</span>
            </div>
          ) : null}

          <EditorContent
            id={id}
            ref={editorShellRef}
            editor={editor}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => {
              setComposing(false)
            }}
            onKeyDownCapture={handleComposerKeyDown}
            onDoubleClick={handleComposerDoubleClick}
            className="pichu-composer-editor min-w-48 flex-1"
            aria-label={t('chat.messageLabel')}
          />
        </div>

        <div className="flex items-center justify-between px-3.5 pb-2.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <ComposerAddMenu
              ready={ready}
              installedPlugins={installedPlugins}
              recentPluginIds={recentPluginIds}
              onOpen={() => void refreshPlugins()}
              onPickAttachments={handlePickAttachments}
              onSelectPlugin={selectContextTag}
              onTogglePlugin={togglePluginEnabled}
              pluginToggleBusyId={pluginToggleBusyId}
            />
            <ApprovalProfileMenu
              value={agentTrustProfile}
              disabled={!ready}
              onChange={handleAgentTrustProfileChange}
            />
          </div>
          <div className="flex items-center gap-(--pichu-composer-button-gap)">
            {showModelSwitcher ? (
              <>
                <ContextUsageIndicator />
                <ModelSwitcher
                  currentModelId={currentModelId}
                  currentThinkingLevel={currentThinkingLevel}
                  onSelect={onModelChange}
                  onThinkingLevelSelect={onThinkingLevelChange}
                  disabled={busy}
                />
              </>
            ) : null}

            {showStopButton ? (
              <IconButton
                label={stopConfirmArmed ? t('chat.stopConfirm') : t('chat.stop')}
                icon={
                  stopConfirmArmed ? (
                    <span className="text-[13px] font-semibold leading-none" aria-hidden>
                      Esc
                    </span>
                  ) : (
                    <span className="size-2.5 rounded-[2px] bg-current" aria-hidden />
                  )
                }
                variant="unstyled"
                size="custom"
                tooltip={
                  <>
                    <span className="font-normal text-foreground">{t('chat.stop')}</span>
                    <kbd className="rounded-full bg-card-muted px-2 py-0.5 text-[13px] font-medium leading-4 text-foreground/85 shadow-[inset_0_0_0_1px_rgb(0_0_0/0.04)] dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]">
                      Esc
                    </kbd>
                  </>
                }
                tooltipSideOffset={5}
                tooltipClassName="flex items-center gap-1.5 rounded-[14px] border-border/55 bg-card px-2.5 py-1.5 text-[14px] leading-5 shadow-[0_2px_10px_rgb(0_0_0_/_0.06)]"
                className="size-(--pichu-composer-button-size) bg-foreground text-background transition hover:bg-foreground/90 focus-visible:ring-ring"
                onClick={() => requestStopCurrentResponse('button')}
              />
            ) : (
              <IconButton
                label={t('chat.send')}
                icon={<ArrowUp className="size-4" strokeWidth={2} aria-hidden />}
                variant="unstyled"
                size="custom"
                tooltip={t('chat.send')}
                className="size-(--pichu-composer-button-size) bg-foreground text-background transition hover:bg-foreground/90 disabled:cursor-default disabled:bg-[#8e8e8e] disabled:text-white disabled:opacity-100 disabled:hover:bg-[#8e8e8e]"
                disabled={!canSubmit}
                onClick={() => handleSubmit('button')}
              />
            )}
          </div>
        </div>
      </div>

      {footer}

      <ToastViewport>
        {agentTrustProfileToast ? (
          <Toast
            key={agentTrustProfileToast.id}
            title={agentTrustProfileToast.title}
            description={agentTrustProfileToast.description}
            variant="error"
            onClose={() => setAgentTrustProfileToast(null)}
            closeLabel={t('approvalProfile.updateFailed.dismiss')}
          />
        ) : null}
      </ToastViewport>
    </div>
  )
}

export const ChatComposer = memo(ChatComposerBase)
ChatComposer.displayName = 'ChatComposer'
