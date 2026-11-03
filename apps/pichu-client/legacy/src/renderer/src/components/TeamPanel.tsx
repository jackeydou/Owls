import { useI18n } from '@renderer/lib/i18n'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { useTeamStore } from '@renderer/stores/team-store'
import { Bot, Plus, Radio, Trash2, Users, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function TeamPanel(): React.JSX.Element {
  const { t } = useI18n()
  const workingDirectory = useSettingsStore((state) => state.workingDirectory)
  const {
    status,
    agents,
    events,
    refreshStatus,
    loadAgents,
    bindEvents,
    destroyTeam,
    createTeam,
    toggleOpen
  } = useTeamStore()
  const [teamName, setTeamName] = useState('dev-team')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    void refreshStatus()
    void loadAgents()
    bindEvents()
    return () => {
      useTeamStore.getState().unsubscribeEvents?.()
    }
  }, [bindEvents, loadAgents, refreshStatus])

  const groupedAgents = useMemo(() => {
    const builtIn = agents.filter((agent) => agent.source === 'builtin')
    const custom = agents.filter((agent) => agent.source !== 'builtin')
    return { builtIn, custom }
  }, [agents])

  return (
    <aside className="flex h-full w-full shrink-0 flex-col border-l border-border/70 bg-card">
      <div className="drag-region relative border-b border-border/70 px-4 py-3">
        <div className="no-drag absolute inset-y-0 right-0 w-20" aria-hidden="true" />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="size-4 text-foreground/70" strokeWidth={1.8} />
            <h2 className="text-[13px] font-semibold text-foreground">Agent Team</h2>
          </div>
          <div className="flex items-center gap-1.5">
            {status ? (
              <button
                type="button"
                onClick={() => {
                  setSubmitting(true)
                  void destroyTeam().finally(() => setSubmitting(false))
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-border/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition hover:bg-card-muted hover:text-destructive"
              >
                <Trash2 className="size-3.5" strokeWidth={1.8} />
                Destroy
              </button>
            ) : null}
            <button
              type="button"
              onClick={toggleOpen}
              className="rounded-md p-1 text-muted-foreground transition hover:bg-card-muted hover:text-foreground"
              aria-label={t('rightSidebar.closeTeamPanel')}
            >
              <X className="size-4" strokeWidth={1.8} />
            </button>
          </div>
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          Persistent teammates share the same project files and coordinate through a task board and
          mailbox.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {!status ? (
          <div className="mb-5 rounded-xl border border-border/70 bg-background px-3.5 py-3">
            <div className="mb-2 text-[12px] font-medium text-foreground">Create a team</div>
            <input
              value={teamName}
              onChange={(event) => setTeamName(event.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none transition placeholder:text-muted-foreground/40 focus:border-border-strong focus:ring-1 focus:ring-border-strong"
              placeholder="dev-team"
              spellCheck={false}
            />
            <button
              type="button"
              disabled={submitting || !teamName.trim() || !workingDirectory.trim()}
              onClick={() => {
                setSubmitting(true)
                void createTeam(teamName.trim(), workingDirectory).finally(() =>
                  setSubmitting(false)
                )
              }}
              className="mt-3 inline-flex items-center gap-2 rounded-md bg-foreground px-3 py-2 text-[12px] font-medium text-background transition hover:opacity-90 disabled:opacity-30"
            >
              <Plus className="size-3.5" strokeWidth={1.8} />
              {submitting ? 'Creating...' : 'Create Team'}
            </button>
          </div>
        ) : (
          <div className="mb-5 rounded-xl border border-border/70 bg-background px-3.5 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[12px] font-medium text-foreground">{status.teamName}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">{status.cwd}</div>
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-full border border-border/70 px-2 py-1 text-[11px] text-muted-foreground">
                <Radio className="size-3" strokeWidth={1.8} />
                {status.teammates.length} teammate{status.teammates.length === 1 ? '' : 's'}
              </div>
            </div>
          </div>
        )}

        <section className="mb-5">
          <div className="mb-2 text-[12px] font-medium text-foreground">Available Agents</div>
          <div className="space-y-2">
            {[...groupedAgents.builtIn, ...groupedAgents.custom].map((agent) => (
              <div
                key={agent.id}
                className="rounded-xl border border-border/60 bg-background px-3 py-2.5"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-medium text-foreground">
                      {agent.name}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                      {agent.description}
                    </div>
                  </div>
                  <div className="shrink-0 rounded-full border border-border/70 px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground/80">
                    {agent.source}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {status ? (
          <>
            <section className="mb-5">
              <div className="mb-2 text-[12px] font-medium text-foreground">Teammates</div>
              <div className="space-y-2">
                {status.teammates.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border/70 px-3 py-4 text-[12px] text-muted-foreground">
                    No teammates spawned yet. The lead agent can use `teamSpawn` to create one.
                  </div>
                ) : (
                  status.teammates.map((teammate) => (
                    <div
                      key={teammate.agentId}
                      className="rounded-xl border border-border/60 bg-background px-3 py-2.5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Bot className="size-3.5 text-foreground/60" strokeWidth={1.8} />
                            <span className="truncate text-[12px] font-medium text-foreground">
                              {teammate.name}
                            </span>
                          </div>
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            {teammate.description}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-[11px] font-medium text-foreground">
                            {teammate.status}
                          </div>
                          <div className="mt-0.5 text-[10px] text-muted-foreground/70">
                            {relativeTime(teammate.lastActiveAt)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="mb-5">
              <div className="mb-2 text-[12px] font-medium text-foreground">Task Board</div>
              <div className="space-y-2">
                {status.tasks.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border/70 px-3 py-4 text-[12px] text-muted-foreground">
                    No tasks yet. The lead agent can use `teamAssignTask`.
                  </div>
                ) : (
                  status.tasks.map((task) => (
                    <div
                      key={task.id}
                      className="rounded-xl border border-border/60 bg-background px-3 py-2.5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[12px] font-medium text-foreground">
                            #{task.id} {task.subject}
                          </div>
                          <div className="mt-0.5 line-clamp-3 text-[11px] text-muted-foreground">
                            {task.description}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-[11px] font-medium text-foreground">
                            {task.status}
                          </div>
                          <div className="mt-0.5 text-[10px] text-muted-foreground/70">
                            {task.owner || 'unassigned'}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </>
        ) : null}

        <section>
          <div className="mb-2 text-[12px] font-medium text-foreground">Event Log</div>
          <div className="space-y-2">
            {events.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/70 px-3 py-4 text-[12px] text-muted-foreground">
                No team events yet.
              </div>
            ) : (
              [...events]
                .reverse()
                .slice(0, 20)
                .map((event) => (
                  <div
                    key={`${event.timestamp}-${event.type}-${'detail' in event ? (event.detail ?? '') : 'message' in event ? event.message.id : 'task' in event ? event.task.id : 'teammateName' in event ? event.teammateName : event.teamName}`}
                    className="rounded-xl border border-border/60 bg-background px-3 py-2"
                  >
                    <div className="text-[11px] font-medium text-foreground">{event.type}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {'detail' in event && event.detail
                        ? event.detail
                        : 'message' in event && event.message
                          ? event.message.text
                          : 'task' in event && event.task
                            ? event.task.subject
                            : 'teammateName' in event
                              ? event.teammateName
                              : event.teamName}
                    </div>
                  </div>
                ))
            )}
          </div>
        </section>
      </div>
    </aside>
  )
}
