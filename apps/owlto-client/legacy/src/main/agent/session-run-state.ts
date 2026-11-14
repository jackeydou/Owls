import type { WebContents } from 'electron'
import { browserCursorSessionKeysForAgentSession } from '../browser-use/session-key.js'
import { writeChatDiagnosticEvent } from '../diagnostics.js'
import type { HumanInputSuspensionMarker } from '../human-input-runtime.js'
import { endEmbeddedBrowserCursorSession } from '../ipc-handlers/embedded-browser-handler.js'
import { listHumanInputRequests } from '../stores/human-input-store.js'
import { type AgentRunRow, createAgentRun, finishAgentRun } from '../stores/settings-store.js'
import { pendingToolApprovalIdsBySession } from '../stores/tool-approval-store.js'
import type { AgentRunFinishStatus } from './types.js'

export type AgentSessionRunStatus = 'idle' | 'running' | 'waiting_for_user' | 'waiting_for_approval'

export class AgentSessionRunState {
  private readonly runningPromptSessionIds = new Set<string>()
  private readonly activeRunIdsBySession = new Map<string, string>()
  private readonly activeRunStartedAtsBySession = new Map<string, string>()
  private readonly activeRunAbortControllersBySession = new Map<string, AbortController>()
  private readonly waitingInputIdsBySession = new Map<string, string>()
  private readonly waitingApprovalIdsBySession = new Map<string, string>()

  constructor(private readonly getRendererWebContents: () => WebContents | null) {}

  isRunning(sessionId: string): boolean {
    return this.runningPromptSessionIds.has(sessionId)
  }

  isWaiting(sessionId: string, waitingApprovalIds: Map<string, string>): boolean {
    return this.waitingInputIdsBySession.has(sessionId) || waitingApprovalIds.has(sessionId)
  }

  runningSessionIds(): string[] {
    return [...this.runningPromptSessionIds]
  }

  activeRunId(sessionId: string): string | null {
    return this.activeRunIdsBySession.get(sessionId) ?? null
  }

  activeRunIds(): Map<string, string> {
    return new Map(this.activeRunIdsBySession)
  }

  activeRunStartedAts(): Map<string, string> {
    return new Map(this.activeRunStartedAtsBySession)
  }

  waitingInputIds(): Map<string, string> {
    const waitingInputIds = new Map(this.waitingInputIdsBySession)
    for (const request of listHumanInputRequests()) {
      if (
        (request.status === 'pending' ||
          request.status === 'submitted' ||
          request.status === 'cancelled') &&
        !this.runningPromptSessionIds.has(request.sessionId) &&
        !waitingInputIds.has(request.sessionId)
      ) {
        waitingInputIds.set(request.sessionId, request.id)
      }
    }
    return waitingInputIds
  }

  waitingApprovalIds(): Map<string, string> {
    return new Map([...pendingToolApprovalIdsBySession(), ...this.waitingApprovalIdsBySession])
  }

  markWaiting(sessionId: string, requestId: string): void {
    this.waitingInputIdsBySession.set(sessionId, requestId)
  }

  runStatusBySession(
    waitingInputIds = this.waitingInputIds(),
    waitingApprovalIds = this.waitingApprovalIds()
  ): Record<string, AgentSessionRunStatus> {
    const statuses: Record<string, AgentSessionRunStatus> = {}
    for (const sessionId of this.runningPromptSessionIds) {
      statuses[sessionId] = 'running'
    }
    for (const sessionId of waitingApprovalIds.keys()) {
      statuses[sessionId] = 'waiting_for_approval'
    }
    for (const sessionId of waitingInputIds.keys()) {
      if (!this.runningPromptSessionIds.has(sessionId) && !waitingApprovalIds.has(sessionId)) {
        statuses[sessionId] = 'waiting_for_user'
      }
    }
    return statuses
  }

  beginRun(sessionId: string): string {
    const run = createAgentRun({ sessionId })
    writeChatDiagnosticEvent({
      event: 'agent_run_created',
      sessionId,
      runId: run.id,
      details: {
        startedAt: run.startedAt
      }
    })
    this.setRunState(sessionId, true, run.id, run.startedAt)
    this.activeRunAbortControllersBySession.set(sessionId, new AbortController())
    return run.id
  }

  activeRunSignal(sessionId: string): AbortSignal | undefined {
    return this.activeRunAbortControllersBySession.get(sessionId)?.signal
  }

  abortActiveRun(sessionId: string, reason?: string): void {
    const controller = this.activeRunAbortControllersBySession.get(sessionId)
    if (!controller || controller.signal.aborted) return
    controller.abort(reason ? new Error(reason) : undefined)
  }

  finishRun(sessionId: string, status: AgentRunFinishStatus, error?: unknown): void {
    const runId = this.activeRunIdsBySession.get(sessionId)
    let completedRun: AgentRunRow | null = null
    if (runId) {
      completedRun = finishAgentRun({
        runId,
        status,
        error: error instanceof Error ? error.message : error ? String(error) : null
      })
      writeChatDiagnosticEvent({
        event: 'agent_run_finished',
        sessionId,
        runId,
        details: {
          status,
          durationMs: completedRun?.durationMs ?? null,
          hasError: Boolean(error)
        }
      })
    }
    this.setRunState(sessionId, false, undefined, undefined, completedRun)
    this.activeRunAbortControllersBySession.delete(sessionId)
    this.waitingApprovalIdsBySession.delete(sessionId)
  }

  setWaitingForToolApproval(sessionId: string, requestId: string): string | null {
    const runId = this.activeRunIdsBySession.get(sessionId) ?? null
    this.runningPromptSessionIds.delete(sessionId)
    this.waitingApprovalIdsBySession.set(sessionId, requestId)
    this.endBrowserCursor(sessionId)
    this.emitRunState(sessionId, false, 'waiting_for_approval')
    return runId
  }

  clearWaitingForToolApproval(sessionId: string, requestId: string, resumeRunning: boolean): void {
    const memoryRequestId = this.waitingApprovalIdsBySession.get(sessionId)
    if (memoryRequestId && memoryRequestId !== requestId) return
    if (!memoryRequestId) {
      this.emitRunState(
        sessionId,
        this.runningPromptSessionIds.has(sessionId),
        this.runningPromptSessionIds.has(sessionId) ? 'running' : 'idle'
      )
      return
    }
    this.waitingApprovalIdsBySession.delete(sessionId)
    if (resumeRunning) {
      this.runningPromptSessionIds.add(sessionId)
      this.emitRunState(sessionId, true, 'running')
    } else {
      this.emitRunState(sessionId, false, 'idle')
    }
  }

  setWaitingForHumanInput(marker: HumanInputSuspensionMarker): void {
    this.runningPromptSessionIds.delete(marker.sessionId)
    this.activeRunIdsBySession.delete(marker.sessionId)
    this.activeRunStartedAtsBySession.delete(marker.sessionId)
    this.activeRunAbortControllersBySession.delete(marker.sessionId)
    this.waitingInputIdsBySession.set(marker.sessionId, marker.requestId)
    this.waitingApprovalIdsBySession.delete(marker.sessionId)
    this.endBrowserCursor(marker.sessionId)

    const wc = this.getRendererWebContents()
    if (!wc) return
    const waitingInputIds = this.waitingInputIds()
    const waitingApprovalIds = this.waitingApprovalIds()
    wc.send('agent:run-state', {
      sessionId: marker.sessionId,
      running: false,
      status: 'waiting_for_user',
      activeRunId: null,
      activeRunStartedAt: null,
      runningSessionIds: [...this.runningPromptSessionIds],
      waitingSessionIds: [...new Set([...waitingInputIds.keys(), ...waitingApprovalIds.keys()])],
      runStatusBySession: this.runStatusBySession(waitingInputIds, waitingApprovalIds),
      waitingInputIdBySession: Object.fromEntries(waitingInputIds),
      waitingApprovalIdBySession: Object.fromEntries(waitingApprovalIds)
    })
  }

  clearSession(sessionId: string): void {
    this.waitingInputIdsBySession.delete(sessionId)
    this.waitingApprovalIdsBySession.delete(sessionId)
  }

  private endBrowserCursor(sessionId: string): void {
    for (const sessionKey of browserCursorSessionKeysForAgentSession(sessionId)) {
      endEmbeddedBrowserCursorSession(sessionKey)
    }
  }

  private emitRunState(
    sessionId: string,
    running: boolean,
    status: AgentSessionRunStatus,
    completedRun?: AgentRunRow | null
  ): void {
    const wc = this.getRendererWebContents()
    if (!wc) return
    const waitingInputIds = this.waitingInputIds()
    const waitingApprovalIds = this.waitingApprovalIds()
    wc.send('agent:run-state', {
      sessionId,
      running,
      status,
      activeRunId: this.activeRunIdsBySession.get(sessionId) ?? null,
      activeRunStartedAt: this.activeRunStartedAtsBySession.get(sessionId) ?? null,
      completedRun: completedRun ?? null,
      runningSessionIds: [...this.runningPromptSessionIds],
      waitingSessionIds: [...new Set([...waitingInputIds.keys(), ...waitingApprovalIds.keys()])],
      runStatusBySession: this.runStatusBySession(waitingInputIds, waitingApprovalIds),
      waitingInputIdBySession: Object.fromEntries(waitingInputIds),
      waitingApprovalIdBySession: Object.fromEntries(waitingApprovalIds)
    })
  }

  private setRunState(
    sessionId: string,
    running: boolean,
    runId?: string,
    runStartedAt?: string,
    completedRun?: AgentRunRow | null
  ): void {
    if (running) {
      this.runningPromptSessionIds.add(sessionId)
      this.waitingInputIdsBySession.delete(sessionId)
      this.waitingApprovalIdsBySession.delete(sessionId)
      if (runId) {
        this.activeRunIdsBySession.set(sessionId, runId)
      }
      if (runStartedAt) {
        this.activeRunStartedAtsBySession.set(sessionId, runStartedAt)
      }
    } else {
      this.runningPromptSessionIds.delete(sessionId)
      this.activeRunIdsBySession.delete(sessionId)
      this.activeRunStartedAtsBySession.delete(sessionId)
      this.endBrowserCursor(sessionId)
    }

    this.emitRunState(sessionId, running, running ? 'running' : 'idle', completedRun)
  }
}
