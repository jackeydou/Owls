# Owls Human-In-The-Loop Tool Execution Design

## Background

Owls currently stores a tool call and its tool result in one `messages` row:

- `role = 'tool'`
- `content` stores the serialized tool call name and arguments.
- `tool_call_id` identifies the model tool call.
- `tool_name` stores the tool name for display and replay.
- `tool_call_result` stores the serialized result after execution.

When a session is restored, `rowsToAgentMessages(...)` expands one persisted
tool row back into an assistant `toolCall` message and, when
`tool_call_result` is not null, a `toolResult` message. This gives Owls a
natural persistence point for deferred human input: the pending state can be
stored while `tool_call_result` is null. The user response is first written to
`human_input_requests.response_json`; the resumed tool execution later returns
that value and writes the final `tool_call_result` through the normal
`tool_execution_end` path.

The important product requirement is that a human-in-the-loop request must
survive renderer reloads and app restarts. Therefore the implementation should
not rely on an in-memory `execute(...)` promise waiting for the user. Instead,
human input should suspend the current agent run, persist the pending request,
and resume the agent from persisted messages after the user responds.

## Goals

- Let selected tools stop before execution and wait for explicit user input.
- Persist pending human input so the user can close and reopen the app before
  answering.
- Store the submitted user input as the original tool call's tool result.
- Resume the same session without adding a synthetic user message.
- Keep renderer access narrow: no generic database, filesystem, shell, or agent
  runtime primitives.
- Keep automation runs deterministic and non-interactive by failing or returning
  a stable cancellation result instead of waiting for a user.

## Non-Goals

- Do not implement a general approval engine in the first version.
- Do not support arbitrary JSON Schema forms in the first version.
- Do not make database writes alone drive agent execution; a resume entry point
  is still required after persisted state changes.
- Do not expose a renderer API that can submit tool results for arbitrary tool
  calls without validating a pending human input request.
- Do not use environment variables for runtime switches.

## Must-Resolve Design Issues

Phase 1 must resolve these items before the feature can be considered safe to
ship:

- **Continuation after restore:** do not rely on pi-agent continuing from a
  restored assistant `toolCall` that has no matching `toolResult`. Owls needs a
  named continuation helper that finds the unresolved tool call, executes that
  tool through the normal wrapper, appends the produced `toolResult`, and only
  then calls normal agent continuation.
- **Atomic request completion:** the write that stores
  `messages.tool_call_result` and the write that marks the matching
  `human_input_requests` row `resolved` must happen in one transaction. A split
  write can leave the one-open-interrupt guard permanently blocked after a
  completed tool result.
- **Suspension filtering:** an internal `PICHU_HUMAN_INPUT_REQUIRED` suspension
  must not be persisted or rendered as a normal failed tool result. Filtering
  only the SQLite write is insufficient; the in-memory runtime transcript and
  renderer completion path must also treat it as a waiting state.
- **Non-interactive runs:** automation and other non-interactive sources must
  return a deterministic cancellation result without inserting
  `human_input_requests` rows.
- **Compaction safety:** context compaction must not compact across unresolved
  HITL tool rows, including submitted or cancelled requests whose
  `messages.tool_call_result` is still null.
- **Runtime context injection:** the HITL helper must be injected through tool
  factory closure state. Do not add a fourth `execute(...)` argument because
  pi-agent already uses that slot for `onUpdate`.

## Terminology

| Term | Meaning |
| --- | --- |
| HITL | Human in the loop. |
| Deferred result tool | A tool whose result is supplied later by the user instead of by immediate execution. |
| Pending request | A persisted human input request tied to one `session_id` and `tool_call_id`. |
| Suspension | A controlled stop of the current agent run because the next required value must come from the user. |
| Resume | Rebuilding the session runtime from persisted messages and continuing generation after the pending tool result is supplied. |

## Current Message Model

The existing message model should be preserved. A HITL request should not add a
new message role.

Pending state:

```text
messages.role = 'tool'
messages.content = '{"name":"ask_user","arguments":{...}}'
messages.tool_call_id = 'call_xxx'
messages.tool_name = 'ask_user'
messages.tool_call_result = null
```

Completed tool execution state:

```text
messages.role = 'tool'
messages.content = '{"name":"ask_user","arguments":{...}}'
messages.tool_call_id = 'call_xxx'
messages.tool_name = 'ask_user'
messages.tool_call_result = '{"ok":true,"value":...}'
```

This state exists after the resumed tool execution finishes and emits
`tool_execution_end`. It is not written directly by `submitHumanInput(...)`.
Before resume, the submitted user value lives in
`human_input_requests.response_json` while `messages.tool_call_result` remains
null.

On later session restore, the completed row expands into:

```text
assistant: toolCall(id='call_xxx', name='ask_user', arguments=...)
toolResult: toolCallId='call_xxx', content='{"ok":true,"value":...}'
```

This keeps transcripts compatible with the existing restore path and avoids a
new persisted message shape.

## Data Model

Add a dedicated table for pending and completed human input requests. The
`messages` row remains the source of truth for model replay; the new table is
the source of truth for UI state, validation, and lifecycle.

```ts
export const humanInputRequests = sqliteTable(
  'human_input_requests',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.sessionId, { onDelete: 'cascade' }),
    runId: text('run_id'),
    toolCallId: text('tool_call_id').notNull(),
    toolName: text('tool_name').notNull(),
    interruptKey: text('interrupt_key').notNull(),
    status: text('status', {
      enum: ['pending', 'submitted', 'cancelled', 'resolved', 'expired']
    }).notNull(),
    resolvedOutcome: text('resolved_outcome', {
      enum: ['submitted', 'cancelled']
    }),
    requestJson: text('request_json').notNull(),
    responseJson: text('response_json'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => [
    index('idx_human_input_session_status').on(table.sessionId, table.status),
    uniqueIndex('idx_human_input_interrupt').on(
      table.sessionId,
      table.toolCallId,
      table.interruptKey
    )
  ]
)
```

SQLite should enforce a partial unique index for active unresolved statuses:

```sql
CREATE UNIQUE INDEX idx_human_input_single_unresolved_session
ON human_input_requests(session_id)
WHERE status IN ('pending', 'submitted', 'cancelled');
```

This is required for Phase 1's one-open-interrupt-per-session rule. The insert
path must also check this inside the same transaction that creates the pending
request, so parallel `ask_user` calls cannot both create pending rows before
the first suspension aborts the run. When resumed tool execution successfully
persists `messages.tool_call_result`, the matching
`human_input_requests.status = 'resolved'` update must happen in the same
database transaction. Implement this as a single store helper, for example
`completeHumanInputToolResult(...)`, that writes the tool result, marks the
request resolved, and updates the session timestamp atomically. If either write
fails, both must roll back so the partial index cannot remain blocked after a
completed tool row.

`interrupt_key` identifies the interrupt site within a tool call. Phase 1 can
use a fixed key such as `default` for `ask_user`, because that tool has only
one interrupt site. Future business tools that call the same interrupt helper
multiple times must provide stable keys, such as `confirm-delete` or
`collect-account-id`, so replay can match the submitted value to the same
logical interrupt.

Request JSON:

```ts
type HumanInputRequestPayload = {
  title: string
  prompt: string
  input: HumanInputControl
  defaultValue?: unknown
  toolArgsSnapshot: Record<string, unknown>
}

type HumanInputControl =
  | { type: 'text'; multiline?: boolean; required?: boolean }
  | {
      type: 'select'
      required?: boolean
      multiple?: boolean
      options: HumanInputSelectOption[]
    }
  | { type: 'confirmation' }

type HumanInputSelectOption = {
  label: string
  value: string
}
```

Response JSON:

```ts
type HumanInputResponsePayload =
  | {
      ok: true
      value: unknown
    }
  | {
      ok: false
      cancelled: true
      reason: string
    }
```

The renderer should not need to inspect the raw `messages.tool_call_result` to
know whether the user already answered. It should read the
`human_input_requests.status` and `response_json` fields through a narrow
main-process API. `response_json` may contain sensitive user data, so the API
should return either the exact submitted value only when the widget needs to
show it, or a redacted display summary for sensitive controls.

Separate renderer form state from model-facing tool result state:

- `request_json.input` is the renderer contract. It tells the UI which form
  control to render.
- `submitHumanInput(...)` accepts a value matching that control.
- Main validates and normalizes the value.
- `response_json` stores the normalized user response for UI replay.
- On resume, the interrupted tool re-enters, reads `response_json` by
  `tool_call_id + interrupt_key`, and returns through normal tool execution.
- `messages.tool_call_result` is written by the existing
  `tool_execution_end` persistence path, not directly by `submitHumanInput`.

Because the UI contract is centralized in `HumanInputControl`, the renderer
does not need to handle arbitrary result shapes from different tools. Phase 1
only has one producer, `ask_user`, but future tools can reuse the same
interrupt helper and still render through the same finite control union.

Keep validation local and explicit. Do not add a broad JSON Schema dependency
unless later form requirements justify it.

## Interrupt Contract

Provide a generic runtime interrupt helper for tools, plus one Phase 1
agent-visible tool that uses it:

```ts
type HumanInputInterruptRequest = AskUserInputRequest & {
  interruptKey: string
}

type ToolExecutionContext = {
  interruptForHumanInput(
    toolCallId: string,
    request: HumanInputInterruptRequest
  ): Promise<HumanInputResponsePayload>
}
```

`interruptForHumanInput(...)` is the LangGraph-like primitive. Tool code calls
it at the point where it needs user input. The helper creates or reads a
request tied to `sessionId`, `toolCallId`, `toolName`, and `interruptKey`.

Do not add this context as a new fourth `execute(...)` argument. Current
pi-agent tools use the fourth argument for `onUpdate`:

```ts
execute(toolCallId, params, signal, onUpdate)
```

Owls must inject the helper with an adapter that preserves the existing
signature. The preferred shape is to close over the helper when creating
Owls-owned tools:

```ts
function createAskUserInputTool(runtimeContext: ToolRuntimeContext): AgentTool {
  return {
    name: 'ask_user',
    async execute(toolCallId, params, signal, onUpdate) {
      return interruptForHumanInput(runtimeContext, {
        toolCallId,
        toolName: 'ask_user',
        interruptKey: 'default',
        params,
        signal,
        onUpdate
      })
    }
  }
}
```

If future tools need this helper, wrap or construct those tools in the same
Owls tool factory boundary. Do not replace or repurpose the `onUpdate`
argument.

Phase 1 only exposes one agent-visible tool:

```ts
const askUserTool: AgentTool = {
  name: 'ask_user',
  executionMode: 'sequential',
  async execute(toolCallId, params, signal, onUpdate) {
    return interruptForHumanInput(runtimeContext, {
      toolCallId,
      toolName: 'ask_user',
      interruptKey: 'default',
      title: params.title,
      prompt: params.prompt,
      input: params.input,
      defaultValue: params.defaultValue,
      signal,
      onUpdate
    })
  }
}
```

Set `askUserTool.executionMode = 'sequential'` if supported by the
installed pi-agent version. Sequential execution reduces parallel sibling races,
but it is not sufficient by itself; the transactional session-level pending
guard above remains required.

`ask_user` is the only tool the model calls when it needs user input in
Phase 1. Its implementation immediately delegates to
`interruptForHumanInput(...)`. Future tools can call the same helper directly
inside their own implementation, as long as they provide stable
`interruptKey` values and their pre-interrupt side effects are idempotent.

The helper is similar in spirit to LangGraph `interrupt`. On the first
execution, it creates a pending request and suspends with
`PICHU_HUMAN_INPUT_REQUIRED`. After the user submits or cancels, the agent
resume path re-enters the same tool call. The helper then reads the stored
request state by `interruptKey` and returns the submitted value, so tool code
after the interrupt can continue.

Agent-facing tool arguments:

```ts
type AskUserInputParams = {
  title: string
  prompt: string
  input: HumanInputControl
  defaultValue?: unknown
}
```

The model should call `ask_user` when the agent itself needs to ask a
question. Business tools should call `interruptForHumanInput(...)` when the
tool owns the workflow and needs user input before it can finish.

The interrupt helper should be state-driven:

```ts
async function interruptForHumanInput(toolCallId, request, context) {
  const existing = findHumanInputRequest(context.sessionId, toolCallId, request.interruptKey)

  if (existing?.status === 'submitted') {
    return parseSubmittedInput(existing.responseJson)
  }

  if (existing?.status === 'cancelled') {
    return buildCancelledToolResult(existing.responseJson)
  }

  if (existing?.status === 'expired') {
    return buildExpiredToolResult(existing.responseJson)
  }

  if (existing?.status === 'resolved') {
    throw new Error('Human input request is already resolved.')
  }

  return suspendForHumanInput(toolCallId, request)
}
```

This makes any tool restart-safe by replaying the tool call and returning the
stored input at the same logical interrupt site. It still requires tool authors
to keep work before the interrupt idempotent, because replay re-runs that code.
The `resolved` branch is a hard internal error, not a model-facing tool result.
Continuation and retry validators should reject resolved requests, or any
request whose tool row already has `tool_call_result`, before executing the
tool. A resolved request already has a persisted result and must not produce a
second `tool_execution_end`.

## Run State

Extend the current boolean running model with a session-level waiting state.

```ts
type AgentSessionRunStatus = 'idle' | 'running' | 'waiting_for_user'
```

Renderer-facing status should include:

```ts
type AgentStatus = {
  hasSession: boolean
  sessionId: string | null
  runningSessionIds: string[]
  waitingSessionIds: string[]
  activeRunIdsBySession: Record<string, string>
  waitingInputIdBySession: Record<string, string>
  modelId: string | null
}
```

The existing `runningSessionIds` remains useful for live generation. A waiting
session should not be considered running, because the app may be closed while it
waits.

Phase 1 should enforce at most one pending human input request per session. This
matches the current suspension mechanism, where the first
`PICHU_HUMAN_INPUT_REQUIRED` stops the run before sibling parallel tool calls can
reliably create their own requests. If a second interrupt is attempted while the
session already has a pending request, return a stable tool error that tells the
model to wait for the existing user input.

This must be enforced in storage, not only in memory. The pending request
creation transaction must fail if the same session already has an unresolved
request with status `pending`, `submitted`, or `cancelled` and a matching tool
row whose `tool_call_result` is still null. `ask_user` should also run with
sequential execution where pi-agent supports per-tool execution mode.

Future support for multiple simultaneous pending inputs needs explicit batch
semantics: collect all requested UI payloads before suspending, persist them
together, and resume only after the batch is resolved. That is outside Phase 1.

## Main Process Flow

### 1. Model Emits A Tool Call

The existing event path should still upsert the tool row:

```text
message_update/tool_execution_start
-> upsertToolCallMessage(...)
-> messages.tool_call_result remains null
```

### 2. A Tool Interrupts For Human Input

When `ask_user` or a future business tool calls
`interruptForHumanInput(...)`, the helper should:

1. Validate the tool parameters.
2. Insert `human_input_requests(status='pending')`.
3. Send a renderer event with the request payload.
4. Stop the current agent run with a typed internal suspension.

Use a typed internal error or explicit runtime result. Phase 1 uses the explicit
runtime result because pi-agent may convert thrown tool errors into normal
error tool results before Owls can catch the original exception. Keep the
stable marker shape shared by both paths, for example:

```ts
class HumanInputRequiredError extends Error {
  readonly name = 'HumanInputRequiredError'
  readonly code = 'PICHU_HUMAN_INPUT_REQUIRED'
  constructor(
    readonly sessionId: string,
    readonly requestId: string,
    readonly toolCallId: string
  ) {
    super('Human input is required to continue.')
  }
}
```

The outer `agent.prompt(...)` handler must detect this marker, whether it came
from a caught `HumanInputRequiredError` or from a controlled tool result, and
treat it as `waiting_for_user`, not as a normal failure.

### 3. Agent Run Suspends

On the `PICHU_HUMAN_INPUT_REQUIRED` marker:

- Flush any assistant draft.
- Set run state to `waiting_for_user`.
- Clear `runningPromptSessionIds` for that session.
- Dispose or recreate the session runtime before the next resume. Do not use
  `disposeSessionRuntime(..., force)` directly for this cleanup if it broadcasts
  idle state through `setSessionRunState(false)`. Add a runtime-only cleanup
  helper that unsubscribes, aborts, resets, and removes the runtime while
  preserving or re-emitting `waiting_for_user`.
- Do not notify session completion.
- Do not show a generic error toast.

If pi-agent emits `tool_execution_end` with an error for the internal
suspension, persistence and UI handlers must filter that internal event before
normal tool-result handling. The discriminator must be stable and explicit:

```ts
type HumanInputSuspensionMarker = {
  code: 'PICHU_HUMAN_INPUT_REQUIRED'
  requestId: string
  sessionId: string
  toolCallId: string
}
```

`persistToolEventForSession(...)` must ignore `tool_execution_end` events whose
error result contains this marker, so it does not overwrite the pending
`messages.tool_call_result` with an error. The renderer event handler must also
map the matching tool widget to `waiting_for_user`, not `complete` or `error`.
The wrapper must prevent any `toolResult` message, synthetic message end,
turn-end completion, or agent-end completion from being appended to the in-memory
runtime transcript for `PICHU_HUMAN_INPUT_REQUIRED`. Filtering only the database
write is not enough; manual continuation depends on the restored tool row still
being unresolved.
The initial `tool_execution_start` for the suspending tool is allowed to remain;
it creates the visible tool row/card. After the pending request is created,
tool_execution_update or partial-result events from the wrapper should be
suppressed unless they carry the human-input request state. Generic progress
updates after suspension would make the renderer drift back toward `running`.
If pi-agent strips custom error properties from tool errors, Phase 1 must first
add a controlled Owls wrapper path that emits this marker before any generic
tool error event is forwarded.

### 4. User Submits Input

Renderer calls:

```ts
window.api.agent.submitHumanInput({
  requestId,
  value
})
```

Main process must:

1. Load the pending request by id.
2. Verify `status === 'pending'`.
3. Validate the submitted value against `request_json.input`.
4. Normalize the submitted value into `response_json`.
5. In one transaction:
   - update `human_input_requests.status = 'submitted'`
   - write `human_input_requests.response_json`
   - update `sessions.updated_at`
6. Resume the agent session.

`submitHumanInput(...)` must not write `messages.tool_call_result` directly.
The tool result should be produced by re-entering the interrupted tool during
resume. In Phase 1 that tool is `ask_user`; future tools use the same path.
That lets the normal `tool_execution_end` event write
`messages.tool_call_result` and keeps persistence consistent with other tools.

### 5. User Cancels Input

There are two useful cancel modes:

```ts
type HumanInputCancelMode = 'return_cancelled_result' | 'stop_task'
```

For the first version, prefer `return_cancelled_result`:

```json
{
  "ok": false,
  "cancelled": true,
  "reason": "User cancelled the input request."
}
```

Then resume the agent so it can explain that it cannot continue or choose a
safe alternative. `stop_task` can be added later for a product action that
abandons the run without another model call.

## Resume Flow

Add a main-process helper:

```ts
async function continueSessionAfterHumanInput(sessionId: string): Promise<void>
```

Responsibilities:

1. Recreate the session runtime from persisted storage. Do not call
   `resumeAgentSession(sessionId)` while an existing runtime is still registered,
   because the current helper returns early in that case and would keep stale
   in-memory messages.
2. Rebuild agent messages from `getSessionMessages(sessionId)` after the
   submitted `human_input_requests.response_json` transaction has committed.
3. Continue the unresolved tool call without adding a new user message. The
   re-entered tool reaches the same `interruptForHumanInput(...)` call, reads
   the submitted request, and continues.
4. Let the normal `tool_execution_end` path write `messages.tool_call_result`.
5. Continue generation after the returned tool result.
6. Set run state back to `idle` when done, or `waiting_for_user` again if
   another HITL request is emitted.

The implementation should add a main-process helper such as:

```ts
async function recreateSessionRuntimeFromStore(sessionId: string): Promise<Agent>
```

This helper should unsubscribe, abort, reset, and remove any existing runtime
for the session without broadcasting idle state over the waiting UI, then
rebuild it from the stored session rows. It is a main-process implementation
detail and must not be exposed through preload.

Current pi-agent continuation semantics should be treated as insufficient unless
verified otherwise. The installed `@earendil-works/pi-agent-core` documentation
describes `continue()` as requiring the last context message to be a user or
toolResult message, while the HITL resume transcript ends with an assistant
`toolCall` without a matching `toolResult`. Therefore Phase 1 must implement a
named Owls continuation helper unless pi-agent is upgraded or proven to support
unresolved restored tool calls.

The helper must use this exact transcript contract:

- Input transcript is exactly `rowsToAgentMessages(getSessionMessages(sessionId),
  model)` after `human_input_requests.response_json` has been written and before
  `messages.tool_call_result` has been written.
- No synthetic user message is added.
- No hidden assistant "continue" message is persisted.
- Owls locates the unresolved assistant `toolCall` without a matching
  `toolResult`, resolves its `toolName` in the current tool registry, and
  executes that tool manually through the same wrapper used during normal agent
  runs.
- The helper emits or forwards the same `tool_execution_start` and
  `tool_execution_end` events as normal tool execution so existing persistence,
  diagnostics and renderer widgets stay consistent.
- These events represent the resume execution attempt, not the original
  suspended attempt. Tool metrics should measure this resumed start/end pair
  separately so dashboards do not treat the suspended request as one long-running
  tool call or as an accidental duplicate.
- The returned tool result is appended as the matching `toolResult` and
  persisted through the normal `tool_execution_end` path.
- The continuation helper must update the owned main-process runtime transcript
  to include the matching `toolResult` before calling normal agent
  continuation. Persisting to SQLite alone is not sufficient for the newly
  recreated runtime.
- `tool_execution_end` persistence must call the atomic
  `completeHumanInputToolResult(...)` helper for interrupted requests, so the
  tool result and `resolved` status are committed together.
- After the transcript tail is a valid `toolResult`, Owls can call normal
  agent continuation to generate the next assistant response.
- Any assistant output after the tool result is persisted through the normal
  assistant streaming path.

The helper may mutate `runtime.agent.state.messages` only inside this
main-process continuation boundary, after it has executed the unresolved tool
and produced the tool result. Renderer input must never mutate runtime messages
directly, and tool results must not use a nonstandard persistence path.

Do not implement resume by directly editing `runtime.agent.state.messages` from
renderer input. The renderer should only submit or cancel a validated pending
request.

## IPC And Preload API

Add narrow APIs under the existing agent namespace:

```ts
type HumanInputRequestForRenderer = {
  id: string
  sessionId: string
  runId: string | null
  toolCallId: string
  toolName: string
  status: 'pending' | 'submitted' | 'cancelled' | 'resolved' | 'expired'
  title: string
  prompt: string
  input: HumanInputControl
  defaultValue?: unknown
  resolvedOutcome?: 'submitted' | 'cancelled'
  response?: HumanInputResponseForRenderer
  createdAt: string
  updatedAt: string
}

type HumanInputResponseForRenderer =
  | {
      ok: true
      value: unknown
      displayValue: string
    }
  | {
      ok: false
      cancelled: true
      reason: string
    }
  | {
      ok: false
      expired: true
      reason: string
    }
}

type SubmitHumanInputPayload = {
  requestId: string
  value: string | string[] | boolean
}

agent: {
  listHumanInputs(sessionId?: string): Promise<HumanInputRequestForRenderer[]>
  submitHumanInput(payload: SubmitHumanInputPayload): Promise<void>
  cancelHumanInput(payload: { requestId: string; mode?: HumanInputCancelMode }): Promise<void>
  continueAfterHumanInput(payload: { sessionId: string; requestId?: string }): Promise<void>
  onHumanInputRequested(callback: (request: HumanInputRequestForRenderer) => void): () => void
  onHumanInputUpdated(callback: (request: HumanInputRequestForRenderer) => void): () => void
}
```

`text` and single-select controls submit strings. Select options are suggestions:
the renderer must also expose a custom input path, and the main process accepts
any non-empty custom select value. Multi-select submits a string array containing
selected option values and, when present, the custom value. The main process
disambiguates them from the stored request's `request_json.input`, not from the
submit payload alone. Renderer code should submit:

| Input control | Renderer UI | Submit value | Model-facing result |
| --- | --- | --- | --- |
| `text` | text input or textarea | string | `{ ok: true, value: string }` |
| `select` | radio-style option list plus custom input | selected or custom value string | `{ ok: true, value: string }` |
| `select` with `multiple: true` | checkbox-style option list plus custom input | selected and custom value array | `{ ok: true, value: string[] }` |
| `confirmation` | confirm/cancel buttons | boolean | `{ ok: true, value: boolean }` |

`continueAfterHumanInput(...)` is the narrow retry API for the case where
submission succeeded but resume failed. Main must validate that the session has
a `submitted` or `cancelled` human input request whose matching
`messages.tool_call_result` is still null before retrying continuation. The
optional `requestId` narrows the retry to a specific request when the renderer
is showing one input widget.

Renderer reload recovery should call `listHumanInputs(...)` after loading a
session. App startup can also surface a badge for sessions with pending input.

## Session Export And Import

Phase 1 exports completed HITL interactions through the normal persisted tool
row only. That means exported JSONL sessions include `messages.tool_call_result`
after a request has resolved, but they do not include
`human_input_requests` rows for pending, submitted, or cancelled-but-unresolved
requests.

Imported sessions therefore cannot resume an unresolved HITL request from the
source device. If a session is exported while waiting for input, the imported
copy may show the unresolved tool call in transcript history, but it will not
have the local request lifecycle data required for submission. The original
device remains the owner of pending HITL completion. A future sharing design can
add explicit pending-request transfer semantics if product requirements need
cross-device completion.

## Renderer UX

Represent pending input in the existing chat and tool widget model.

Extend tool widget state:

```ts
type ToolWidgetStatus =
  | 'streaming'
  | 'running'
  | 'waiting_for_user'
  | 'complete'
  | 'error'
```

When the renderer receives or loads a human input request:

- Match it to the tool widget by `toolCallId`.
- If `status === 'pending'`, set widget status to `waiting_for_user`, render an
  inline form, and allow submit/cancel through the preload API.
- If `status === 'submitted'`, render a read-only submitted state using
  `response.displayValue` and disable submit/cancel controls.
- If `status === 'cancelled'`, render a read-only cancelled state with the
  cancellation reason.
- If `status === 'resolved'`, render a read-only completed state. Use
  `resolvedOutcome` or `response.cancelled` to distinguish answered-completed
  from cancelled-completed.
- If `status === 'expired'`, render a read-only expired state and offer only
  safe session-level recovery actions, not a direct resubmit.
- Disable duplicate submits while the IPC call is in flight.

The submit IPC must also enforce single submission in main. If the renderer
submits a request whose status is no longer `pending`, main should reject with a
stable validation error and emit the latest request state back to the renderer.

Do not use a modal as the only input surface. The request belongs to a specific
tool call, so the primary UI should live with that tool card. A separate session
list badge is useful for navigation but should not replace the inline request.

All visible and accessibility copy must go through i18next with English and
Simplified Chinese entries.

## Automation Behavior

Automation runs are not interactive. If the model calls `ask_user` during
an automation run, the tool should return a stable cancellation result instead
of creating a pending request:

```json
{
  "ok": false,
  "cancelled": true,
  "reason": "This run was triggered by an automation and cannot request interactive input."
}
```

This avoids abandoned scheduled runs and keeps automation transcripts
deterministic.
Automation and other non-interactive sources must bypass the
`human_input_requests` table entirely. Do not insert `pending`, `cancelled`, or
`resolved` rows for non-interactive cancellation results; otherwise the
session-level unresolved unique index can block later interactive HITL requests
without any valid resume path.

The tool runtime needs explicit run context to enforce this. Extend the
`createToolsForCwd(...)` options with a stable source flag, for example:

```ts
type ToolRuntimeContext = {
  source: 'chat' | 'automation'
  interactive: boolean
}
```

`createAgentRuntime(...)` already knows the source, but the current tool factory
only receives cron inclusion and session/model callbacks. Phase 1 must pass the
source or `interactive` flag into tool creation so `ask_user`, and later
any tool using `interruptForHumanInput(...)`, can choose between pending request
creation for chat runs and deterministic cancellation for automation runs.

## Compaction And Transcript Safety

Context compaction must preserve unresolved HITL tool rows. A tool row with
`tool_call_result = null` is not enough to continue the model, but it is
required for the UI and for the pending request relation.

Before compacting a session that has unresolved human input:

- Either skip compaction for rows at and after the pending tool call.
- Or include a marker that preserves the pending tool call and the
  `human_input_requests` relation.

The first version should choose the simpler rule: do not compact across a
human input request whose status is `pending`, `submitted`, or `cancelled` and
whose matching tool row still has `tool_call_result = null`.

This is a Phase 1 implementation requirement, not a later hardening task.
`compactContextForSession(...)` must check for unresolved requests before
creating a marker. If an unresolved request exists, it must preserve all rows at
and after the earliest unresolved tool row outside the compaction marker. Add a
regression test where a submitted-but-unresolved interrupted tool row survives
compaction, later writes `tool_call_result`, and is restored into model context
by `rowsToAgentMessages`.

## Failure Handling

Handle these cases explicitly:

| Case | Behavior |
| --- | --- |
| Renderer reloads | Main pending request remains; renderer reload calls `listHumanInputs`. |
| App restarts | Pending request is loaded from SQLite; user can submit and resume. |
| Session is deleted | `ON DELETE CASCADE` removes pending requests. |
| Tool row missing on submit | Mark request `expired`; return a stable error to renderer. |
| Tool row already has a result | Mark request `expired` or no-op if it matches the same submitted response. |
| User submits invalid value | Reject IPC with a validation error; keep request pending. |
| Resume fails after request update | Keep request `submitted` or `cancelled`; leave `messages.tool_call_result` null and expose retry continue action for the session. |
| Another HITL request appears after resume | Set session back to `waiting_for_user`. |

## Security And Validation

- Treat renderer input as untrusted.
- Validate request ids, session ids, status, and submitted value in main.
- Do not let renderer choose `toolCallId`, `toolName`, or raw serialized tool
  result.
- Do not log full submitted values by default; they may contain credentials or
  private business data.
- Keep tool result serialization deterministic.
- Sort unordered option lists before storing if they come from non-deterministic
  sources.

## Implementation Plan

### Phase 1: Runtime Helper

Foundational persistence and contracts:

- [x] Add shared `human-input` types for request payloads, renderer payloads,
  response payloads, statuses, cancel modes, and IPC payloads.
- [x] Add `human_input_requests` to the Drizzle schema with check constraints,
  session and interrupt indexes, and the partial unique unresolved-session
  SQLite index.
- [x] Generate the matching Drizzle migration and metadata.
- [x] Add main-process store helpers to create pending requests, list requests
  for renderer, submit/cancel requests, expire invalid requests, find unresolved
  requests, and atomically complete a HITL tool result.
- [x] Add focused store-level tests for create, submit, cancel, duplicate
  submit, session-level unresolved uniqueness, and atomic completion.

Runtime helper and tool surface:

- [x] Add `HumanInputRequiredError` and stable suspension marker helpers.
- [x] Add `interruptForHumanInput(...)` with state-driven replay behavior for
  pending, submitted, cancelled, expired, and resolved requests.
- [x] Add the Phase 1 `ask_user` tool with finite input validation and
  `executionMode = 'sequential'` when supported by pi-agent.
- [x] Extend `createToolsForCwd(...)` options with explicit runtime context
  (`source` and `interactive`) and pass it from chat and automation runtime
  creation.
- [x] Ensure automation calls to `ask_user` return the deterministic
  non-interactive cancellation result without touching
  `human_input_requests`.

Run state, suspension, and continuation:

- [x] Replace the boolean-only run state with
  `idle | running | waiting_for_user`, while keeping `runningSessionIds` for
  compatibility.
- [x] Detect `PICHU_HUMAN_INPUT_REQUIRED` in chat and detached run handling,
  flush drafts, clean up runtime state without broadcasting idle, and emit
  `waiting_for_user`.
- [x] Filter `PICHU_HUMAN_INPUT_REQUIRED` events before tool-result
  persistence, renderer completion handling, in-memory transcript mutation, and
  generic error UI.
- [x] Rebuild runtime state from persisted messages before continuation without
  reusing stale in-memory messages.
- [x] Add `continueSessionAfterHumanInput(...)` to locate the unresolved
  restored tool call, execute it manually through the normal tool wrapper, append
  the matching `toolResult`, persist through normal tool-end handling, then call
  normal agent continuation.
- [x] Validate `continueAfterHumanInput(...)` retries only submitted or
  cancelled unresolved requests whose matching tool row still has no result.

IPC and renderer recovery:

- [x] Add narrow preload/main APIs for list, submit, cancel, retry continue,
  `onHumanInputRequested`, and `onHumanInputUpdated`.
- [x] Emit request-created and request-updated events after transactional state
  changes.
- [x] Load human input requests when opening or restoring a session.
- [x] Extend tool widget status with `waiting_for_user`.
- [x] Render inline pending, submitted, cancelled, resolved, and expired HITL
  states on the matching tool card.
- [x] Route all visible and accessibility copy through i18next English and
  Simplified Chinese entries.

Compaction, import/export, and verification:

- [x] Prevent context compaction from compacting across unresolved HITL tool
  rows.
- [x] Decide export/import behavior for pending requests; Phase 1 can export
  completed tool results only and document pending request limitations.
- [ ] Add regression tests for restore, no-synthetic-user continuation,
  suspension filtering, automation cancellation, compaction safety, IPC
  validation, and renderer reload recovery.
- [x] Run scoped final checks:
  `pnpm --filter pichu-client typecheck:node`,
  `pnpm --filter pichu-client typecheck:web`, and relevant package tests.
  Local store tests currently skip when the installed `better-sqlite3` native
  module targets Electron's ABI instead of the host Node ABI.

### Phase 2: Approval Integration

- [ ] Define an approval-specific request payload that reuses the finite
  renderer control union without exposing arbitrary tool-result writes.
- [ ] Reuse request lifecycle, status events, and renderer inline UI for
  approval prompts.
- [ ] Keep approval result separate from business tool result unless the model
  needs to know that the action was cancelled.
- [ ] Integrate with future `PermissionRequest` hook behavior.

## Test Plan

Main-process tests:

- `ask_user` inserts one pending request and keeps its tool row pending.
- `interruptForHumanInput(...)` returns a submitted value when replay reaches
  the same `toolCallId + interruptKey`.
- Submitting valid input writes `human_input_requests.response_json`, then
  the re-entered interrupted tool writes `messages.tool_call_result` through
  normal tool execution.
- Cancelling writes a cancellation response, then the re-entered interrupted
  tool writes a cancellation tool result through normal tool execution.
- Submitting after app-style runtime recreation resumes from persisted rows.
- Submitting while the app is still open recreates the runtime and does not use
  stale in-memory messages.
- Phase 1 rejects a second pending interrupt in the same session with a stable
  tool error.
- Parallel `ask_user` calls cannot create two unresolved requests in the
  same session.
- Duplicate submit is rejected or idempotent.
- Submitted, cancelled, and expired requests are returned to renderer as
  read-only request states.
- `continueAfterHumanInput(...)` retries a submitted unresolved request and
  cancelled unresolved request, and rejects requests that are pending, expired,
  or already have a tool result.
- Missing tool row marks the request expired.
- Automation runs receive a non-interactive cancellation result.
- Internal `PICHU_HUMAN_INPUT_REQUIRED` suspension events do not write an error
  `tool_call_result`.
- Internal `PICHU_HUMAN_INPUT_REQUIRED` suspension does not append a synthetic
  `toolResult`, message end, turn end, or agent end to the runtime transcript.
- Context compaction does not compact across an unresolved interrupted tool row.

Renderer tests:

- Pending request sets the matching widget to `waiting_for_user`.
- Form validation blocks empty required text input.
- Submit and cancel disable repeated actions while pending.
- Loading a session restores pending and completed input state from
  `listHumanInputs`.
- Submitted, cancelled, and expired input widgets do not allow another submit.

Verification commands should be scoped to touched surfaces:

```bash
pnpm --filter pichu-client typecheck:node
pnpm --filter pichu-client typecheck:web
pnpm --filter pichu-client test:plugins
```

Run database migration checks if the final implementation adds the schema above.

## Open Questions

- Does pi-agent provide a supported continue API after restoring a transcript
  with a newly available `toolResult`, or does Owls need a named continuation
  helper?
- Should a submitted request immediately resume in the background, or should
  the user explicitly click continue when reopening an old pending session?
- Should pending input block session deletion, or should deletion silently
  cascade and cancel the request?
- How should shared/imported sessions represent pending requests that cannot be
  completed by the current user?
- Should input values be included in exported JSONL sessions, or should exports
  include only the resulting `tool_call_result`?
