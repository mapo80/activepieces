# Command Layer — Developer Guide

A practical reference for adding `useCommandLayer: true` flows and customising
the per-flow behaviour. For architecture and rationale see
[solution-final-v3.3.md](./solution-final-v3.3.md). For migration of an
existing flow, see [command-layer-migration-guide.md](./command-layer-migration-guide.md).

## When to enable the command layer

Turn on `settings.useCommandLayer: true` when the flow needs:

- **Composite turns** — a single user message must update fields *and* answer
  an info-question / handle a meta-question / propose a cancellation.
- **Server-governed policy** — extracted values must be cited by exact
  evidence in the user message (P3), and updates must be atomic per turn.
- **Saga-safe persistence** — the turn must be replay-safe (idempotency on
  `turnId`) and crash-safe (prepared → finalized | compensated).
- **Realtime UI feedback** — the chat needs intermediate `INTERACTIVE_FLOW_TURN_EVENT`
  WebSocket events (lease acquired, fields extracted, turn finalized).

Leave `useCommandLayer: false` (or absent) for simple linear flows where the
legacy `field-extractor + question-generator` chain is sufficient.

## Enabling on a flow

Set the flag in the action settings of the INTERACTIVE_FLOW step:

```json
{
  "type": "INTERACTIVE_FLOW",
  "settings": {
    "useCommandLayer": true,
    "infoIntents": [
      { "id": "count_accounts", "renderer": "count_accounts" }
    ],
    "stateFields": [
      { "name": "customerName", "type": "string", "extractable": true,
        "minLength": 2, "maxLength": 50 }
    ],
    "nodes": [...]
  }
}
```

Required environment:

- `AP_DB_TYPE=POSTGRES` (production) or `PGLITE` (local/CI). The flow validator
  rejects publish on any other DB type with i18n key
  `validation.commandLayer.requiresPostgres`.
- `AP_LLM_VIA_BRIDGE=true` to route the command layer through the
  `claude-code-openai-bridge` (default off, falls back to `MockProviderAdapter`).
- `AP_COMMAND_LAYER_MODEL` (default `claude-sonnet-4-6`) — model hint for the
  Vercel AI SDK adapter.
- Optional knobs: `AP_OUTBOX_POLL_MS` (default 500), `AP_LOCK_RECOVERY_POLL_MS`
  (default 10_000).

## Writing infoIntent renderers

`infoIntents` map intent ids to deterministic server-side renderer functions.
A renderer receives the turn state and returns a localised string + the field
ids it relied on (cited fields).

Renderer registration lives in
`packages/server/api/src/app/ai/command-layer/info-renderer.ts`. Add a new
intent by:

1. Add the intent id to the flow's `settings.infoIntents` array (with a
   matching `renderer` name).
2. Implement the renderer function (pure: no side-effects, no external
   network) and register it in `info-renderer.ts`.
3. The runtime uses `ANSWER_INFO` commands emitted by the LLM to invoke
   your renderer; cited fields appear in the turn-event audit trail.

## System prompt rules

The system prompt is built per turn from `prompt-builder.ts`. The builder
injects:

- The flow's `systemPrompt` (free-form, language-locale aware via `locale`).
- The current `state` (snapshot, redacted by `pii-redactor`).
- The pending interaction (if any) and the most recent `historyMaxTurns`
  conversation entries.
- The dynamic tools registry (one tool per ConversationCommand type).

Keep the flow's `systemPrompt` focused on domain rules: do not list the
ConversationCommand types — the schema is auto-derived from
`ConversationCommandSchema` and provided as JSON-Schema tool inputs.

Avoid PII or secrets in the prompt itself: the prompt is logged for tracing
purposes via `commandLayerTracing.withSpan`.

## Testing locally

The default provider is `MockProviderAdapter`. Register expected commands
keyed by user message:

```typescript
import { MockProviderAdapter } from '@/ai/command-layer/provider-adapter'

const provider = new MockProviderAdapter()
provider.register({
  matchUserMessage: (msg) => msg.toLowerCase().includes('bellafronte'),
  commands: [{
    type: 'SET_FIELDS',
    updates: [{ field: 'customerName', value: 'Bellafronte', evidence: 'Bellafronte' }],
  }],
})
const result = await turnInterpreter.interpret({
  request: turnRequest,
  provider,
  identityFields: ['customerName'],
})
```

Run the integration suite:

```bash
cd packages/server/api && export $(cat .env.tests | xargs) && \
  AP_EDITION=ce npx vitest run test/integration/ce/ai/
```

Real-LLM smoke (bridge required): start the
`claude-code-openai-bridge` (`curl -sf http://localhost:8787/health` returns 200),
then `AP_LLM_VIA_BRIDGE=true ./dev-start.sh` and exercise the flow via the UI.

## Endpoints

All endpoints are under `/v1/engine/interactive-flow-ai/command-layer/` and
require `securityAccess.engine()`:

| Method | Path | Purpose |
|---|---|---|
| POST | `/interpret-turn` | Single-turn interpret + propose commands. Returns `prepared` status with `finalizeContract` on success. |
| POST | `/interpret-turn/finalize` | Commit a prepared turn (saga finalize). Idempotent on the `(turnId, leaseToken)` pair. |
| POST | `/interpret-turn/rollback` | Compensate a prepared turn (saga rollback). |
| GET | `/outbox/replay` | Re-emit `publishable` events for a session after a given `sessionSequence`. |
| GET | `/metrics` | Counter snapshot (`leaseAcquired`, `outboxPublished`, …). |
| GET | `/traces` | Aggregated span timings + error rates. |
| POST | `/admin/force-clear-stale` | Manually reclaim stale `in-progress` and `prepared` turns. |

## Diagnostic queries

```sql
-- Recent turns by status
SELECT status, count(*) FROM "interactive_flow_turn_log"
WHERE "createdAt" > NOW() - INTERVAL '1 hour'
GROUP BY status;

-- Outbox event status mix per session
SELECT "sessionId", "eventStatus", count(*) FROM "interactive_flow_outbox"
WHERE "createdAt" > NOW() - INTERVAL '1 hour'
GROUP BY "sessionId", "eventStatus" ORDER BY 1, 2;

-- Stuck prepared sagas (older than 5 minutes — should be reclaimed by daemon)
SELECT * FROM "interactive_flow_turn_log"
WHERE status = 'prepared' AND "createdAt" < NOW() - INTERVAL '5 minutes';
```

## Anti-patterns

- **Don't** mix legacy `fieldExtractor` with `useCommandLayer: true` — pick
  one path per flow.
- **Don't** rely on the LLM to follow the schema as plain text; the dynamic
  tools registry (`buildToolsRegistry` in `vercel-ai-adapter.ts`) is the
  contract.
- **Don't** add long-running side-effects inside an `ANSWER_INFO` renderer.
  Renderers must be pure and fast.
- **Don't** disable the lock-recovery daemon in production — prepared sagas
  without a finalize would never roll back.
