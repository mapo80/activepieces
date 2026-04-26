# Engine

## Error Handling

- **Always throw `ExecutionError` subclasses** (from `@activepieces/shared`) instead of plain `Error`. The engine uses `tryCatchAndThrowOnEngineError` which only propagates errors of type `ExecutionErrorType.ENGINE` — plain `Error` instances are silently swallowed and treated as user-level failures.
- Use `EngineGenericError` for engine-level failures (e.g., failed API calls to the server).
- Use the existing specific error classes (`ConnectionNotFoundError`, `StorageLimitError`, `PausedFlowTimeoutError`, etc.) when applicable.

## Debugging `interactive-flow-executor`

The engine runs as a forked Node process under the worker. Its
`stdout`/`stderr` are captured by the sandbox via socket RPC into
`stdOut` / `stdError` buffers and are **only surfaced to the worker
on `uncaughtException`** (see `sandbox.ts:286-327`). In normal runs,
`console.log` from the executor goes nowhere visible.

To trace the `INTERACTIVE_FLOW` executor without editing its source,
set one of these env vars on the **worker** process (the engine
inherits them):

```bash
# 1) Write JSONL to a file (recommended for dev — grep-friendly)
AP_IF_DEBUG_LOG=/tmp/ap-if.log bun run serve:worker

# 2) Engine stderr only (best-effort: buffered by worker)
AP_IF_DEBUG=true bun run serve:worker
```

The `ifDebug(...)` helper in `interactive-flow-executor.ts` emits
JSONL lines at these permanent trace points:

| Stage | When |
|---|---|
| `handle:enter` | on every invocation (action/flowRunId/isCompleted/hasResumeBody) |
| `handle:already-completed` | early return from already-completed step |
| `handle:resume:incoming` | resume payload received (keys + user-message preview) |
| `handle:resume:extracted` | field-extractor returned keys on resume |
| `handle:first-turn:begin` | first-turn extractor about to run (template + user-message preview) |
| `handle:first-turn:extracted` | extracted keys on first turn |
| `handle:first-turn:error` | field-extractor threw |
| `handle:deadlock` | no pause node found + unresolved tools (lists them) |
| `handle:pause:begin` | pause node picked (id, dynamic flag) |
| `handle:pause:message` | bot message resolved (preview + generated-by-llm flag) |
| `handle:pause:sendFlowResponse` / `:result` | attempt + outcome of pushing sync bot bubble |
| `handle:success:begin` | success path reached (state keys + caseId if any) |
| `handle:success:sendFlowResponse:result` | outcome of final sync push |
| `handle:session:loaded` | cross-run state+history pulled from store-entries |
| `handle:session:miss` | no persisted session for this key (first turn) |
| `handle:session:version-reset` | `flowVersionId` mismatch → state reset |
| `handle:session:topic-change` | extractor changed an already-set extractable field → cleared tool outputs |
| `handle:session:saved` | bytes/history-length of just-written record |
| `handle:session:cleared` | terminal success + `cleanupOnSuccess:true` → DELETE |
| `handle:session:load-error` | store-entries GET failed (network / 5xx) |
| `handle:session:save-error` | store-entries PUT/DELETE failed |

Disabled = zero overhead (early return). No need to edit the file to
add/remove logs — toggle the env var instead.

## Session store (cross-run state + history)

`INTERACTIVE_FLOW` actions declare `sessionIdInput` (expression
against the trigger, e.g. `{{trigger.sessionId}}`) to opt into
multi-turn persistence. The helper lives at
[session-store.ts](src/lib/handler/session-store.ts) and wraps the
`/v1/store-entries` API via [createContextStore](src/lib/piece-context/store.ts:6).

Key shape: `ifsession:<namespace>:<sessionId>`, where
`namespace = settings.sessionNamespace ?? action.name`. Different IF
actions are isolated by default; set the same `sessionNamespace`
value on two IFs to share state+history (pipeline mode).

Record shape (`SessionRecord`):
- `state`: `InteractiveFlowState`
- `history`: `{ role: 'user' | 'assistant', text: string }[]`
- `flowVersionId`: current version — on mismatch the record is
  dropped at load time.
- `lastTurnAt`: ISO timestamp, informational.

Constraints:
- 512KB per store-entry — the helper logs `handle:session:over-size`
  and truncates history to 5 turns when the payload crosses 400KB.
- `historyMaxTurns` (default 20) only caps what's persisted + passed
  to the question-generator; the React chat UI keeps its own local
  log so the user never sees a mid-conversation gap.

## Coverage

Enforced thresholds in [vitest.config.ts](vitest.config.ts):

| File | Lines | Functions |
|---|---|---|
| `session-store.ts` | ≥ 90% | ≥ 90% |
| `interactive-flow-executor.ts` | ≥ 70% | ≥ 80% |

Run locally:

```bash
cd packages/server/engine
npm run test:coverage
```

## Command Layer integration

The executor delegates each INTERACTIVE_FLOW turn to the API-side command
layer (the legacy `field-extractor` chain was removed on 2026-04-26).
The integration points are:

- `turn-interpreter-client.ts` — HTTP wrapper around
  `POST /v1/engine/interactive-flow-ai/command-layer/interpret-turn` (and
  `/finalize` / `/rollback`).
- `turn-interpreter-adapter.ts` — converts the `InterpretTurnResponse` into
  the executor-consumed extractResult shape (preserving
  `pendingOverwriteSignal`, `rejectionHint`, `topicChange`, executed-node
  reset semantics).
- `status-renderer.ts` — composes the post-DAG bot message in two parts:
  `preDagAck` (from `messageOut.preDagAck`) + the post-DAG status text
  derived from final state.
- `turn-result.ts` — shared TurnResult shape; carries `messageOut` so the
  executor can surface the bifase bot message.
- `question-generator.ts` — calls `POST /v1/engine/interactive-flow-ai/question-generate`
  to render dynamic messages on USER_INPUT/CONFIRM nodes (when
  `message.dynamic === true`). Distinct from the command-layer saga.

For each turn, the executor calls `commandLayerClientAdapter.interpret`,
then `finalize` (or `rollback` on save-failure). State diff, executed node
reset on topic change, and pending interactions are applied to the runtime
state by the executor based on `InterpretTurnResponse`.
