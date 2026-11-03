import { Button } from '@renderer/components/ui/button'
import { IconButton } from '@renderer/components/ui/icon-button'
import i18next from 'i18next'
import {
  AlertCircle,
  ArrowUp,
  Check,
  ChevronDown,
  FileDiff,
  FolderOpen,
  Loader2,
  Network,
  Plus,
  Search,
  Settings2,
  Square,
  Terminal,
  Trash2,
  X
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import owlMark from '../../../../resources/pichu-home-mark.png'
import type { CodexSession } from '../../../shared/codex'
import { RouterView } from '../router/RouterView'
import { TaskOptions } from './Controls'
import { ConversationItem, RequestCard } from './Conversation'
import { failureMessage } from './failures'
import { CodexSettingsPage } from './Settings'
import { agentConnection, isAgentReady, useCodexStore } from './store'
import './codex.css'

function projectName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}
function isActive(session?: CodexSession): boolean {
  return Boolean(session && ['running', 'starting', 'waiting'].includes(session.status))
}
function Sidebar() {
  const { t } = useTranslation()
  const {
    sessions,
    projects,
    selectedId,
    select,
    newTask,
    pickProject,
    showSettings,
    showRouter,
    routerProjectId,
    view,
    settings
  } = useCodexStore()
  const connection = useCodexStore((s) => agentConnection(s, settings.provider))
  const [search, setSearch] = useState('')
  const filtered = sessions.filter((s) =>
    `${s.title} ${s.cwd}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())
  )
  return (
    <aside className="codex-sidebar">
      <div className="codex-sidebar-brand">
        <img src={owlMark} alt="" />
        <span>Owls</span>
      </div>
      <Button variant="outline" className="codex-new-task" onClick={() => newTask()}>
        <Plus size={16} />
        {t('newTask')}
        <kbd>⌘ N</kbd>
      </Button>
      <div className="codex-search">
        <Search size={14} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('search')}
          aria-label={t('search')}
        />
      </div>
      <div className="codex-sidebar-scroll">
        <div className="codex-sidebar-section-title">
          <span>{t('projects')}</span>
          <IconButton
            size="sm"
            label={t('addProject')}
            tooltip={t('addProject')}
            icon={<Plus size={13} />}
            onClick={() => void pickProject()}
          />
        </div>
        {projects.map((project) => (
          <div
            className={`codex-project-item ${view === 'router' && routerProjectId === project.id ? 'selected' : ''}`}
            key={project.id}
          >
            <button
              type="button"
              className="codex-project-row"
              onClick={() => newTask(project.path)}
            >
              <FolderOpen size={14} />
              <span>{project.name}</span>
              <span className="codex-count">
                {sessions.filter((s) => s.cwd === project.path).length}
              </span>
            </button>
            <IconButton
              className="codex-router-entry"
              size="sm"
              label={t('router.open', { project: project.name })}
              tooltip={t('router.entry')}
              icon={<Network size={13} />}
              onClick={() => showRouter(project.id)}
            />
          </div>
        ))}
        {!projects.length ? (
          <button type="button" className="codex-add-project" onClick={() => void pickProject()}>
            <FolderOpen size={14} />
            {t('chooseFolder')}
          </button>
        ) : null}
        <div className="codex-sidebar-section-title codex-tasks-heading">{t('tasks')}</div>
        {!filtered.length ? (
          <p className="codex-sidebar-empty">{t(search ? 'noResults' : 'noTasks')}</p>
        ) : null}
        {filtered.map((session) => (
          <div
            className={`codex-task-row ${selectedId === session.id && view === 'chat' ? 'selected' : ''}`}
            key={session.id}
          >
            <button type="button" className="codex-task-select" onClick={() => select(session.id)}>
              {isActive(session) ? (
                <span className={`codex-task-dot ${session.status}`} />
              ) : (
                <Terminal size={13} />
              )}
              <span>
                <strong>{session.title || t('untitled')}</strong>
                <small>
                  {projectName(session.cwd)} · {t(`agent.${session.provider}`)}
                </small>
              </span>
            </button>
            {!isActive(session) ? (
              <IconButton
                className="codex-task-remove"
                size="sm"
                label={t('removeTask')}
                tooltip={t('removeTask')}
                icon={<Trash2 size={12} />}
                onClick={() => void useCodexStore.getState().archive(session.id)}
              />
            ) : null}
          </div>
        ))}
      </div>
      <button
        type="button"
        className={`codex-sidebar-settings ${view === 'settings' ? 'selected' : ''}`}
        onClick={showSettings}
      >
        <Settings2 size={16} />
        <span>{t('settings')}</span>
        <span className={`codex-sidebar-indicator ${connection.status}`} />
      </button>
      <div className="codex-sidebar-footer">{t('nativeRuntime')}</div>
    </aside>
  )
}
function Chat() {
  const { t } = useTranslation()
  const {
    sessions,
    selectedId,
    draftCwd,
    settings,
    sending,
    newTask,
    pickProject,
    showSettings,
    send,
    interrupt
  } = useCodexStore()
  const session = sessions.find((s) => s.id === selectedId)
  const provider = session?.provider ?? settings.provider
  const connection = useCodexStore((s) => agentConnection(s, provider))
  const agent = t(`agent.${provider}`)
  const cwd = session?.cwd ?? draftCwd
  const active = isActive(session)
  const connected = isAgentReady(connection)
  const [text, setText] = useState('')
  const [showDiff, setShowDiff] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const nearBottom = useRef(true)
  const items = session?.items ?? []
  const diff = session?.diff ?? ''
  const diffLines = useMemo(() => {
    const occurrences = new Map<string, number>()
    return diff.split('\n').map((line) => {
      const occurrence = occurrences.get(line) ?? 0
      occurrences.set(line, occurrence + 1)
      return { line, key: `${line}\0${occurrence}` }
    })
  }, [diff])
  useEffect(() => {
    textarea.current?.focus()
  }, [])
  useEffect(() => {
    if (session && nearBottom.current) bottom.current?.scrollIntoView({ block: 'end' })
  }, [session])
  useEffect(() => {
    if (!textarea.current) return
    textarea.current.style.height = 'auto'
    if (text) textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 220)}px`
  }, [text])
  async function submit() {
    if (!text.trim() || !connected || active || sending || !cwd) return
    if (await send(text.trim())) setText('')
  }
  const pending =
    session?.requests.filter((r) => r.status === 'pending' || r.status === 'answering') ?? []
  return (
    <main className="codex-chat">
      <header className="codex-topbar">
        <div className="codex-task-title">
          {session?.title || t('newTask')}
          {cwd ? (
            <span>
              <FolderOpen size={12} />
              {projectName(cwd)}
            </span>
          ) : null}
        </div>
        <div className="codex-topbar-actions">
          <span className={`codex-connection ${connection.status}`}>
            <i />
            {t(`connection.${connection.status}`)}
          </span>
          {session ? (
            <IconButton
              label={t('showChanges')}
              tooltip={t('showChanges')}
              icon={<FileDiff size={16} />}
              onClick={() => setShowDiff(!showDiff)}
            />
          ) : null}
        </div>
      </header>
      <div className="codex-chat-body">
        <div className="codex-conversation-column">
          <div
            className="codex-conversation-scroll"
            ref={scroll}
            onScroll={() => {
              if (scroll.current)
                nearBottom.current =
                  scroll.current.scrollHeight -
                    scroll.current.scrollTop -
                    scroll.current.clientHeight <
                  120
            }}
          >
            <div className="codex-conversation">
              {!items.length ? (
                <div className="codex-welcome">
                  <img src={owlMark} alt="" />
                  <h1>{t(connected ? 'welcome' : 'connectTitle', { agent })}</h1>
                  <p>{t(connected ? 'welcomeBody' : 'connectBody', { agent })}</p>
                  {!connected ? (
                    <Button size="sm" onClick={showSettings}>
                      {connection.status === 'connecting' ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Terminal size={14} />
                      )}
                      {t('openSettings', { agent })}
                    </Button>
                  ) : !cwd ? (
                    <Button size="sm" variant="outline" onClick={() => void pickProject()}>
                      <FolderOpen size={15} />
                      {t('chooseFolder')}
                    </Button>
                  ) : (
                    <span className="codex-welcome-project">
                      <FolderOpen size={14} />
                      {projectName(cwd)}
                      <Check size={12} />
                    </span>
                  )}
                </div>
              ) : (
                items.map((item) => <ConversationItem key={item.id} item={item} agent={agent} />)
              )}
              {active && !pending.length ? (
                <div className="codex-working" role="status">
                  <Loader2 size={13} className="animate-spin" />
                  {t(`status.${session?.status}`)}
                </div>
              ) : null}
              {pending.map((request) => (
                <RequestCard
                  key={request.id}
                  request={request}
                  sessionId={session?.id ?? ''}
                  agent={agent}
                />
              ))}
              {session?.error ? (
                <div className="codex-inline-error" role="alert">
                  <AlertCircle size={15} />
                  <span>{failureMessage(session.error)}</span>
                </div>
              ) : null}
              <div ref={bottom} />
            </div>
          </div>
          <div className="codex-composer-area">
            <div className="codex-composer">
              <textarea
                ref={textarea}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t('prompt', { agent })}
                aria-label={t('prompt', { agent })}
                rows={2}
                disabled={!connected || !cwd || sending}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    void submit()
                  }
                }}
              />
              <div className="codex-composer-toolbar">
                <div className="codex-composer-config">
                  <button
                    type="button"
                    className="codex-folder-button"
                    disabled={Boolean(session)}
                    onClick={() => void pickProject()}
                  >
                    <FolderOpen size={14} />
                    <span>{cwd ? projectName(cwd) : t('chooseProject')}</span>
                    {!session ? <ChevronDown size={12} /> : null}
                  </button>
                  {session ? (
                    <span className="codex-existing-options">
                      {agent}
                      <span>·</span>
                      {session.model ?? t('nativeDefault', { agent })}
                      <span>·</span>
                      {t(`permission.${session.permission}`)}
                    </span>
                  ) : (
                    <TaskOptions compact />
                  )}
                </div>
                {active ? (
                  <IconButton
                    className="codex-stop"
                    label={t('stop')}
                    tooltip={t('stop')}
                    icon={<Square size={13} fill="currentColor" />}
                    onClick={() => void interrupt()}
                  />
                ) : (
                  <IconButton
                    variant="default"
                    className="codex-send"
                    label={t('send')}
                    tooltip={t('send')}
                    icon={
                      sending ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <ArrowUp size={17} />
                      )
                    }
                    disabled={!text.trim() || !connected || !cwd || sending}
                    onClick={() => void submit()}
                  />
                )}
              </div>
            </div>
            <div className="codex-composer-note">
              <span>{!session ? t('trustFolder', { agent }) : t('sendHint')}</span>
              {session?.tokens ? <span>{t('tokens', { count: session.tokens })}</span> : null}
              {session && !active ? <span>{t(`status.${session.status}`)}</span> : null}
            </div>
            {session && !active && session.items.length > 0 ? (
              <button
                type="button"
                className="codex-another-task"
                onClick={() => newTask(cwd ?? undefined)}
              >
                <Plus size={12} />
                {t('newTask')}
              </button>
            ) : null}
          </div>
        </div>
        {showDiff ? (
          <aside className="codex-diff-pane">
            <header>
              <FileDiff size={15} />
              <strong>{t('changes')}</strong>
              <IconButton
                size="sm"
                label={t('closeChanges')}
                tooltip={t('closeChanges')}
                icon={<X size={15} />}
                onClick={() => setShowDiff(false)}
              />
            </header>
            {session?.diff ? (
              <pre>
                {diffLines.map(({ line, key }) => (
                  <div
                    key={key}
                    className={
                      line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : ''
                    }
                  >
                    {line || '\n'}
                  </div>
                ))}
              </pre>
            ) : (
              <p>{t('noChanges')}</p>
            )}
          </aside>
        ) : null}
      </div>
    </main>
  )
}
export default function CodexApp() {
  const { t } = useTranslation()
  const {
    loaded,
    view,
    settings,
    error,
    selectedId,
    draftCwd,
    routerProjectId,
    initialize,
    event,
    clearError
  } = useCodexStore()
  useEffect(() => {
    const unsubscribe = window.codex.onEvent(event)
    void initialize()
    return unsubscribe
  }, [initialize, event])
  useEffect(() => {
    void i18next.changeLanguage(settings.language)
  }, [settings.language])
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const theme =
        settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : settings.theme
      document.documentElement.dataset.theme = theme
      document.documentElement.style.colorScheme = theme
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [settings.theme])
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key === ',') {
        e.preventDefault()
        useCodexStore.getState().showSettings()
      }
      if (e.key.toLowerCase() === 'n') {
        e.preventDefault()
        useCodexStore.getState().newTask()
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [])
  return (
    <div className="codex-app">
      <Sidebar />
      {!loaded ? (
        <main className="codex-loading" role="status">
          <Loader2 size={20} className="animate-spin" />
          {t('loading')}
        </main>
      ) : view === 'settings' ? (
        <CodexSettingsPage />
      ) : view === 'router' ? (
        <RouterView key={routerProjectId ?? 'router'} />
      ) : (
        <Chat key={selectedId ?? draftCwd ?? 'new'} />
      )}
      {error ? (
        <div className="codex-error-toast" role="alert">
          <AlertCircle size={16} />
          <span>{failureMessage(error)}</span>
          <IconButton
            size="sm"
            label={t('dismissError')}
            icon={<X size={14} />}
            onClick={clearError}
          />
        </div>
      ) : null}
    </div>
  )
}
