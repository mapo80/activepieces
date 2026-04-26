# Server Backend

You are working in the Activepieces server API (`packages/server/api`).

## Tech Stack

- **Framework**: Fastify 5
- **ORM**: TypeORM with PostgreSQL
- **Job Queues**: BullMQ
- **Cache/Redis**: ioredis
- **Observability**: OpenTelemetry
- **Language**: TypeScript (strict)

## Project Structure

- `src/app/` — Feature modules (flows, pieces, tables, authentication, webhooks, etc.)
- `src/app/ee/` — Enterprise features (SSO, SAML, SCIM, multi-tenancy)
- `src/app/database/` — Database migrations and connection setup (TypeORM)
- `src/app/helper/` — Shared server utilities

## Patterns

- **Controllers**: Use `FastifyPluginAsyncTypebox` pattern for route definitions with TypeBox schema validation
- **HTTP methods**: Use `POST` for all create and update operations
- **Database migrations**: Generated and managed via TypeORM
- **Feature modules**: Each module typically has controller, service, and entity files
- **Array columns in TypeORM entities**: Always use this pattern:
  ```ts
  columnName: {
      type: String,
      array: true,
      nullable: false,
  }
  ```

## Guidelines

- Read existing code before making changes to understand patterns
- Follow the existing controller/service pattern when adding new endpoints
- Write database migrations for schema changes, never modify entities directly without a migration
- Keep enterprise features isolated in `src/app/ee/`

## Command Layer (`src/app/ai/command-layer`)

Server-governed conversation runtime for INTERACTIVE_FLOW steps. The flow
validator (`src/app/flows/flow-version/interactive-flow-validator.ts`) refuses
publish on unsupported DB types with i18n key
`validation.interactiveFlow.requiresPostgres`. The legacy fallback path
was removed on 2026-04-26 — every INTERACTIVE_FLOW turn goes through the
command layer.

Key modules:

| File | Purpose |
|---|---|
| `turn-interpreter.ts` | Orchestrates a single turn: lease → propose → policy → prepare → outbox INSERT. |
| `command-dispatcher.ts` | Applies accepted ConversationCommands to state + side-effects (topic change, pending). |
| `policy-engine.ts` | Validates proposed commands (P0..P5: schema, evidence, identity, allowed-fields). |
| `provider-adapter.ts` | `MockProviderAdapter` (default for tests). |
| `vercel-ai-adapter.ts` | Real LLM via Vercel AI SDK + dynamic tools registry from `ConversationCommandSchema`. |
| `outbox-publisher.ts` | Background daemon: claims publishable events and emits `INTERACTIVE_FLOW_TURN_EVENT` via WebSocket. |
| `lock-recovery.ts` | Background daemon: reclaims expired in-progress + stale prepared rows. |

Endpoints (all under `/v1/engine/interactive-flow-ai/command-layer/`,
`securityAccess.engine()`):
`/interpret-turn`, `/interpret-turn/finalize`, `/interpret-turn/rollback`,
`/outbox/replay`, `/metrics`, `/traces`, `/admin/force-clear-stale`.

A separate endpoint `POST /v1/engine/interactive-flow-ai/question-generate`
is used by the engine executor to render dynamic messages on
USER_INPUT/CONFIRM nodes (when `message.dynamic === true`).

Wiring at boot lives in `src/app/workers/worker-module.ts`:

- `AP_LLM_VIA_BRIDGE=true` → registers `VercelAIAdapter` via
  `overrideProviderAdapter`. Default adapter is `MockProviderAdapter`.
- `outboxPublisher.start({ pollIntervalMs: AP_OUTBOX_POLL_MS ?? 500 })`
- `lockRecoveryDaemon.start({ pollIntervalMs: AP_LOCK_RECOVERY_POLL_MS ?? 10_000 })`

Feature docs: see `docs/interactive-flow/command-layer-developer-guide.md`.
