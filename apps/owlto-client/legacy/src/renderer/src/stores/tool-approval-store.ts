import { create } from 'zustand'
import type {
  ToolApprovalAutoReviewEvent,
  ToolApprovalRequestForRenderer,
  ToolApprovalResolveBehavior,
  ToolApprovalResolvedEvent
} from '../../../shared/tool-approval'

type ToolApprovalState = {
  requests: ToolApprovalRequestForRenderer[]
  autoReviews: Record<string, ToolApprovalAutoReviewEvent>
  loaded: boolean
  error: string | null
  load: () => Promise<void>
  attachListeners: () => () => void
  resolve: (
    id: string,
    behavior: ToolApprovalResolveBehavior,
    reason?: string,
    options?: { rememberRule?: boolean }
  ) => Promise<void>
}

function upsertRequest(
  requests: ToolApprovalRequestForRenderer[],
  request: ToolApprovalRequestForRenderer
): ToolApprovalRequestForRenderer[] {
  if (resolvedRequestIds.has(request.id)) return requests
  const next = requests.filter((item) => item.id !== request.id)
  next.push(request)
  return next.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

function removeResolved(
  requests: ToolApprovalRequestForRenderer[],
  event: ToolApprovalResolvedEvent
): ToolApprovalRequestForRenderer[] {
  resolvedRequestIds.add(event.id)
  return requests.filter((request) => request.id !== event.id)
}

function mergePendingRequests(
  current: ToolApprovalRequestForRenderer[],
  loaded: ToolApprovalRequestForRenderer[]
): ToolApprovalRequestForRenderer[] {
  const byId = new Map<string, ToolApprovalRequestForRenderer>()
  for (const request of current) {
    if (!resolvedRequestIds.has(request.id)) byId.set(request.id, request)
  }
  for (const request of loaded) {
    if (!resolvedRequestIds.has(request.id)) byId.set(request.id, request)
  }
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

let listenerRefCount = 0
let detachToolApprovalListeners: (() => void) | null = null
const resolvedRequestIds = new Set<string>()

export const useToolApprovalStore = create<ToolApprovalState>((set, get) => ({
  requests: [],
  autoReviews: {},
  loaded: false,
  error: null,

  load: async () => {
    set({ error: null })
    try {
      const requests = await window.api.toolApprovals.list()
      set((state) => ({
        requests: mergePendingRequests(state.requests, requests),
        loaded: true
      }))
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error), loaded: true })
    }
  },

  attachListeners: () => {
    listenerRefCount += 1
    if (!detachToolApprovalListeners) {
      const unsubscribeRequested = window.api.toolApprovals.onRequested((request) => {
        set((state) => ({ requests: upsertRequest(state.requests, request) }))
      })
      const unsubscribeResolved = window.api.toolApprovals.onResolved((event) => {
        set((state) => ({ requests: removeResolved(state.requests, event) }))
      })
      const unsubscribeAutoReviewStarted = window.api.toolApprovals.onAutoReviewStarted((event) => {
        set((state) => ({ autoReviews: { ...state.autoReviews, [event.requestId]: event } }))
      })
      const unsubscribeAutoReviewCompleted = window.api.toolApprovals.onAutoReviewCompleted(
        (event) => {
          set((state) => ({ autoReviews: { ...state.autoReviews, [event.requestId]: event } }))
        }
      )
      detachToolApprovalListeners = () => {
        unsubscribeRequested()
        unsubscribeResolved()
        unsubscribeAutoReviewStarted()
        unsubscribeAutoReviewCompleted()
      }
    }
    let cleanedUp = false
    return () => {
      if (cleanedUp) return
      cleanedUp = true
      listenerRefCount = Math.max(0, listenerRefCount - 1)
      if (listenerRefCount > 0) return
      const detach = detachToolApprovalListeners
      detachToolApprovalListeners = null
      if (detach) {
        detach()
      }
    }
  },

  resolve: async (id, behavior, reason, options) => {
    set({ error: null })
    try {
      await window.api.toolApprovals.resolve({
        id,
        behavior,
        reason,
        rememberRule: options?.rememberRule
      })
      resolvedRequestIds.add(id)
      set((state) => ({ requests: state.requests.filter((request) => request.id !== id) }))
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
      void get().load()
    }
  }
}))
