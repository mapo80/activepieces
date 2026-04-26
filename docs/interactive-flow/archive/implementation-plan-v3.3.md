# INTERACTIVE_FLOW Command Layer — Implementation Plan v3.3

Source architecture: [solution-final-v3.3.md](solution-final-v3.3.md)

This document is the execution plan for implementing v3.3. It is intentionally task-oriented: every phase and task has a stable ID and a status marker.

## Status Legend

| Status | Meaning |
|---|---|
| `TODO` | Not started |
| `IN_PROGRESS` | Work started, not ready for review |
| `BLOCKED` | Cannot proceed without a decision, dependency, or failing prerequisite |
| `READY_FOR_REVIEW` | Implementation done, awaiting review |
| `CHANGES_REQUESTED` | Review found issues |
| `DONE` | Merged/accepted, but not necessarily verified in full gate |
| `VERIFIED` | Done and passed the required gate for the phase |

## Global Non-Negotiable Gates

These gates apply before promoting any phase to `VERIFIED`.

| Gate ID | Status | Requirement | Command / Evidence |
|---|---|---|---|
| G-UNIT-90 | TODO | Unit test coverage for new/changed command-layer modules must be `>= 90%` lines and branches. | Add/extend Vitest coverage config where missing; run package coverage commands. |
| G-LEGACY-INTEGRATION | TODO | Current integration tests must continue to pass. | From repo root: `npm run test-api`. |
| G-ENGINE-UNIT | TODO | Engine unit and coverage tests must pass. | `cd packages/server/engine && npm run test:coverage`. |
| G-SHARED-WEB | TODO | Shared schemas and frontend type/tests must pass. | `cd packages/shared && npm run test`; `cd packages/web && npm run test && npm run typecheck`. |
| G-E2E-API | TODO | API-level command layer integration/e2e tests pass for CE/EE/cloud where applicable. | `npm run test-api`; targeted API integration tests under `packages/server/api/test/integration`. |
| G-E2E-PLAYWRIGHT | TODO | Playwright interactive-flow scenarios pass. | `AP_EDITION=ce npm run test:e2e -- packages/tests-e2e/scenarios/ce/flows/interactive-flow.local.spec.ts packages/tests-e2e/scenarios/ce/flows/interactive-flow-canvas.local.spec.ts`. |
| G-LINT | TODO | Lint passes. | From repo root: `npm run lint-dev`. |
| G-MIGRATIONS | TODO | Migrations are present and no schema drift. | From repo root: `npm run check-migrations`. |

## Phase Overview

| Phase | Status | Objective | Exit Criteria |
|---|---|---|---|
| P0A-SPIKE | TODO | Prove the five concurrency/storage primitives from v3.3 with runnable tests. | Stress tests prove lease, saga, sequence, publisher FIFO, and store-entry CAS. |
| P0A-INFRA | TODO | Implement storage and event infrastructure behind no user-facing feature. | Migrations, entities, repositories, publisher, recovery, CAS endpoint merged and covered. |
| P0B-CONTRACT | TODO | Add shared schemas and runtime contracts. | Shared package exports command, turn-event, interpret DTOs; version bumped. |
| P0C-BENCH | TODO | Build deterministic and real-LLM benchmark harness. | Golden deterministic tests and Anthropic real-run harness available. |
| P1-CORE | TODO | Implement API command layer with mockable provider adapter. | `/interpret-turn` and rollback/finalize APIs work with mock adapter and policies. |
| P2-ENGINE | TODO | Integrate engine via HTTP client behind `useCommandLayer`. | Legacy path untouched; command path produces equivalent `TurnResult` side effects. |
| P3-FRONTEND | TODO | Add durable turn-event stream to UI. | Existing node state UI unchanged; new turn trace renders and replays. |
| P4-HARDENING | TODO | Observability, safety, chaos tests, and compliance controls. | Metrics/alerts/log redaction/model pinning/red-team tests in place. |
| P5-CANARY-READONLY | TODO | Canary read-only consultazione flow. | 7-day metrics meet thresholds, no data-loss defects. |
| P6-CANARY-DISPOSITIVO | TODO | Staging and production rollout for dispositive flow. | Staging sign-off, staged production rollout, kill switch validated. |
| P7-SUNSET | TODO | Retire legacy path after stable rollout. | Legacy endpoint and duplicate logic removed after sunset criteria. |

## P0A-SPIKE — Storage And Concurrency Spike

Purpose: validate v3.3 critical SQL/concurrency assumptions before full implementation.

| Task ID | Status | Task | Deliverable | Gate |
|---|---|---|---|---|
| P0A-SPIKE-01 | TODO | Confirm TypeORM entity naming convention across 3-5 recent entities and migrations. | Decision: camelCase DB columns or explicit `name: 'snake_case'` mapping. | Documented decision in this plan or ADR. |
| P0A-SPIKE-02 | TODO | Prototype `interactive_flow_turn_log` with `lease_token`, `locked_until`, and states `in-progress/prepared/finalized/compensated/failed`. | Temporary migration/entity in spike branch. | Unit + integration test. |
| P0A-SPIKE-03 | TODO | Prove lease acquisition with concurrent same-`turnId` requests. | Test showing exactly one attempt obtains fresh lease; others receive locked/replay state. | `vitest` concurrency test. |
| P0A-SPIKE-04 | TODO | Prove commit CAS on `lease_token`, `status`, and non-expired lease. | Test where stale worker cannot commit after recovery/new lease. | `vitest` integration test. |
| P0A-SPIKE-05 | TODO | Prototype heartbeat lease extension during long LLM simulation. | Abort behavior when heartbeat update affects 0 rows. | Unit + integration test. |
| P0A-SPIKE-06 | TODO | Prototype saga states `prepared -> finalized/compensated`. | Outbox rows are `pending` until finalize, `void` after compensation. | Integration test. |
| P0A-SPIKE-07 | TODO | Prototype sequence table `interactive_flow_session_sequence`. | Atomic per-session range allocation for N events. | 100 parallel sessions test. |
| P0A-SPIKE-08 | TODO | Prototype publisher claim per session, not per row. | One publisher per session at a time, FIFO by `session_sequence`. | 2+ publisher concurrency test. |
| P0A-SPIKE-09 | TODO | Prototype store-entry CAS method separate from existing `upsert`. | `expectedVersion` success/fail behavior without changing legacy `upsert`. | Integration test for 200/412. |
| P0A-SPIKE-10 | TODO | Produce spike report. | Decision report with measured race results and unresolved risks. | Engineering review sign-off. |

Exit gate: all P0A-SPIKE tasks `VERIFIED`. If any core primitive fails, stop and update architecture before implementation.

## P0A-INFRA — Storage And Event Infrastructure

| Task ID | Status | Task | Deliverable | Gate |
|---|---|---|---|---|
| P0A-INFRA-01 | TODO | Add `InteractiveFlowTurnLogEntity` using the convention proven in spike. | `packages/server/api/src/app/ai/command-layer/turn-log-entity.ts`. | Entity registered in `database-connection.ts`. |
| P0A-INFRA-02 | TODO | Add `InteractiveFlowOutboxEntity`. | Outbox entity with `turnId`, `sessionSequence`, `eventStatus`, claim/retry/dead-letter fields. | Unit metadata test. |
| P0A-INFRA-03 | TODO | Add `InteractiveFlowSessionSequenceEntity`. | Sequence allocation table/entity. | Concurrency test. |
| P0A-INFRA-04 | TODO | Register new entities. | Add entities to `getEntities()` in `database-connection.ts`. | Build and migration check. |
| P0A-INFRA-05 | TODO | Create PostgreSQL migration. | `database/migration/postgres/{timestamp}-AddCommandLayerPrimitives.ts`. | `npm run check-migrations`. |
| P0A-INFRA-06 | TODO | Add SQLite/PGLite guard behavior. | Validation/runtime error when `useCommandLayer=true` and DB is not PostgreSQL. | API integration test. |
| P0A-INFRA-07 | TODO | Add turn-log repository/service. | Lease acquire, heartbeat, prepare, finalize, compensate, fail. | `>=90%` unit coverage. |
| P0A-INFRA-08 | TODO | Add session sequence repository/service. | Atomic range allocation per session. | Parallel integration test. |
| P0A-INFRA-09 | TODO | Add outbox repository/service. | Insert pending events, mark publishable/void, claim session batch, publish/dead-letter. | `>=90%` unit coverage. |
| P0A-INFRA-10 | TODO | Add outbox publisher worker/plugin. | Periodic publisher with per-session claim, heartbeat, retry/backoff, dead-letter. | Concurrency test with 2 publishers. |
| P0A-INFRA-11 | TODO | Add lock recovery daemon. | Reclaims expired `in-progress`, compensates stale `prepared`, emits recovery events. | Chaos/recovery tests. |
| P0A-INFRA-12 | TODO | Extend store-entry DB schema with `version BIGINT`. | Migration + entity/type update. | Existing store-entry tests still pass. |
| P0A-INFRA-13 | TODO | Add dedicated store-entry CAS endpoint/method. | New service method, controller route, DTO field, 412 handling. | CE/cloud store-entry integration tests. |
| P0A-INFRA-14 | TODO | Add metrics/logging for storage primitives. | Counters for lease acquired/conflict/stale reclaim/outbox lag/dead-letter/CAS conflict. | Unit test metric labels where feasible. |

Exit gate: `G-MIGRATIONS`, `G-LEGACY-INTEGRATION`, and P0A concurrency tests pass.

## P0B-CONTRACT — Shared Schemas And Contracts

| Task ID | Status | Task | Deliverable | Gate |
|---|---|---|---|---|
| P0B-CONTRACT-01 | TODO | Add `ConversationCommandSchema`. | `packages/shared/src/lib/automation/interactive-flow/conversation-command.ts`. | Shared tests. |
| P0B-CONTRACT-02 | TODO | Add `InteractiveFlowTurnEventSchema`. | Includes `sessionSequence` as bigint-safe string or agreed type. | Contract tests. |
| P0B-CONTRACT-03 | TODO | Add `InterpretTurnRequest/Response` DTOs. | Request/response schema includes `finalizeContract`, `sideEffects`, and `messageOut` object. | API/engine compile. |
| P0B-CONTRACT-04 | TODO | Extend `PendingInteractionSchema` with `pending_cancel`. | `createdAt`, optional reason, TTL-compatible shape. | Resolver tests updated. |
| P0B-CONTRACT-05 | TODO | Extend `InteractiveFlowActionSettings`. | Add optional `infoIntents` and `useCommandLayer`. | Existing fixtures still parse. |
| P0B-CONTRACT-06 | TODO | Add `INTERACTIVE_FLOW_TURN_EVENT` websocket event type. | Shared websocket enum/schema export. | Frontend compile. |
| P0B-CONTRACT-07 | TODO | Export new shared files from barrel. | `packages/shared/src/index.ts`. | Shared build. |
| P0B-CONTRACT-08 | TODO | Bump `packages/shared` minor version. | Version update per root `CLAUDE.md`. | Package build. |

Exit gate: `G-SHARED-WEB` and all current shared tests pass.

## P0C-BENCH — Benchmarks And Test Fixtures

| Task ID | Status | Task | Deliverable | Gate |
|---|---|---|---|---|
| P0C-BENCH-01 | TODO | Create deterministic golden fixture format. | JSON/YAML format for turn input, provider output, expected commands, policies, state diff, events. | Fixture schema test. |
| P0C-BENCH-02 | TODO | Add 20-30 deterministic golden turns. | Consultazione + estinzione flows; mock adapter only. | Deterministic test pass. |
| P0C-BENCH-03 | TODO | Add concurrency golden scenarios. | Retry same turn, CAS conflict, stale lease, publisher replay. | Integration pass. |
| P0C-BENCH-04 | TODO | Add benchmark runner/report. | Latency, policy rejection, fabrication, cache hit metadata. | Report generated locally. |
| P0C-BENCH-05 | TODO | Add real LLM benchmark harness. | 100-200 Anthropic turns behind explicit env flag. | Not run in default CI. |
| P0C-BENCH-06 | TODO | Define benchmark thresholds. | p50/p95, fabrication rate, policy false reject, retry rate. | Threshold doc accepted. |

Exit gate: deterministic benchmark in CI; real LLM benchmark runnable manually.

## P1-CORE — API Command Layer

| Task ID | Status | Task | Deliverable | Gate |
|---|---|---|---|---|
| P1-CORE-01 | TODO | Add command-layer module folder and service boundaries. | `packages/server/api/src/app/ai/command-layer/*`. | API build. |
| P1-CORE-02 | TODO | Implement `ProviderAdapter` interface. | Mock adapter + Vercel AI adapter using `interactiveFlowModelFactory`. | Unit tests with mock. |
| P1-CORE-03 | TODO | Implement prompt builder. | Fields, pending, infoIntents, catalogReadiness, sanitized state. | Snapshot/unit tests. |
| P1-CORE-04 | TODO | Implement pre-resolvers. | Pending, cancel keywords, deterministic yes/no/ordinal paths. | `>=90%` coverage. |
| P1-CORE-05 | TODO | Extend pending resolver for `pending_cancel`. | TTL, accept/reject, expire events. | Resolver tests. |
| P1-CORE-06 | TODO | Implement policy engine P1-P6/P8/P9a/P9b. | Includes exact `candidatePolicy.verifyEvidence({ evidence, userMessage })`. | `>=90%` coverage. |
| P1-CORE-07 | TODO | Implement normalized write-set conflict resolver. | Field-level conflict detection for SET_FIELDS + RESOLVE_PENDING. | Matrix tests. |
| P1-CORE-08 | TODO | Implement `CommandDispatcher`. | State diff, pending diff, side effects, turn events, topic change, overwrite flow. | `>=90%` coverage. |
| P1-CORE-09 | TODO | Implement `InfoRenderer`. | Server-side renderer registry with locale support and PII-safe outputs. | Renderer tests. |
| P1-CORE-10 | TODO | Implement `CommandLayerInterpreter`. | Orchestrates lease, provider, policy, dispatcher, prepare outbox. | Integration tests with mock provider. |
| P1-CORE-11 | TODO | Add `/interpret-turn` endpoint. | Engine-authenticated API endpoint with Zod request/response. | API unit/integration tests. |
| P1-CORE-12 | TODO | Add `/interpret-turn/finalize` endpoint. | Finalizes prepared turn and publishes pending outbox events. | Saga tests. |
| P1-CORE-13 | TODO | Add `/interpret-turn/rollback` endpoint. | Compensates prepared turn and emits rollback event. | Saga tests. |
| P1-CORE-14 | TODO | Add replay behavior. | finalized returns cached result; compensated returns deterministic error; in-progress returns 409. | Idempotency tests. |

Exit gate: API command-layer coverage `>=90%`, `npm run test-unit`, targeted integration tests, and no regression in `npm run test-api`.

## P2-ENGINE — Engine Integration Behind Feature Flag

| Task ID | Status | Task | Deliverable | Gate |
|---|---|---|---|---|
| P2-ENGINE-01 | TODO | Add `turn-interpreter-client.ts`. | HTTP client mirroring `field-extractor.ts`, with typed errors and response validation. | Unit tests. |
| P2-ENGINE-02 | TODO | Define engine-side `TurnResult`. | Complete shape for legacy and command-layer adapters. | Compile and tests. |
| P2-ENGINE-03 | TODO | Implement `LegacyFieldExtractorAdapter`. | Wraps existing `fieldExtractor.extractWithPolicy`. | Existing tests unchanged. |
| P2-ENGINE-04 | TODO | Implement `CommandLayerClientAdapter`. | Adapts interpret response to `TurnResult`. | Unit tests. |
| P2-ENGINE-05 | TODO | Extract common apply-turn-result helper. | Applies state diff, pending, policy decisions, rejection hints, topic changes, node resets. | Unit tests. |
| P2-ENGINE-06 | TODO | Preserve first-turn catalog pre-execution. | Existing engine code remains engine-side; add `catalogReadiness`. | Existing first-turn tests. |
| P2-ENGINE-07 | TODO | Integrate feature flag on resume path. | Replace direct extraction branch at resume with adapter selection. | Engine tests. |
| P2-ENGINE-08 | TODO | Integrate feature flag on first-turn path. | Replace first-turn extraction branch with adapter selection after catalog pre-exec. | Engine tests. |
| P2-ENGINE-09 | TODO | Add session `loadWithRevision/saveWithCAS`. | Uses dedicated store-entry CAS endpoint. | Session-store coverage `>=90%`. |
| P2-ENGINE-10 | TODO | Add finalize/rollback calls around session save. | Finalize after CAS success; rollback on CAS fail/permanent save failure. | Chaos-style tests. |
| P2-ENGINE-11 | TODO | Add `StatusRenderer` engine-side. | Post-DAG success/failure status appended safely to pre-DAG ack. | Unit tests. |
| P2-ENGINE-12 | TODO | Keep legacy behavior unchanged when `useCommandLayer` is false. | No behavior drift in existing interactive-flow executor tests. | Existing engine suite. |

Exit gate: `G-ENGINE-UNIT`, existing engine tests pass, and command path tests cover all side effects listed in v3.3 §5.

## P3-FRONTEND — Turn Event Stream

| Task ID | Status | Task | Deliverable | Gate |
|---|---|---|---|---|
| P3-FE-01 | TODO | Add `useInteractiveFlowTurnEvents`. | Subscribe to `INTERACTIVE_FLOW_TURN_EVENT`, filter by session/run, dedupe by `outboxEventId`. | Hook tests. |
| P3-FE-02 | TODO | Add turn-event reducer. | Ordered merge by `sessionSequence`, gap detection, replay request support. | Reducer tests. |
| P3-FE-03 | TODO | Keep node-state reducer unchanged. | No `InteractiveFlowNodeStateEvent` semantic pollution. | Existing tests. |
| P3-FE-04 | TODO | Extend chat runtime timeline. | Render node events + command turn events without mixing statuses. | Component tests. |
| P3-FE-05 | TODO | Add reconnect replay flow. | Client sends `lastKnownSessionSequence`; server returns ordered events. | Playwright/e2e. |
| P3-FE-06 | TODO | Add UI copy for PostgreSQL-only validation error. | Clear user-facing error for `useCommandLayer=true` on unsupported DB. | Frontend test. |

Exit gate: `cd packages/web && npm run test && npm run typecheck`, then Playwright interactive-flow scenarios.

## P4-HARDENING — Safety, Observability, Chaos

| Task ID | Status | Task | Deliverable | Gate |
|---|---|---|---|---|
| P4-HARD-01 | TODO | Add OpenTelemetry spans. | interpret-turn, provider, policy, saga, outbox publish, CAS save. | Trace smoke test. |
| P4-HARD-02 | TODO | Add metrics and alerts. | Outbox lag, dead-letter, stale lease, CAS conflict, policy rejection, provider error. | Metric unit tests where feasible. |
| P4-HARD-03 | TODO | Add PII redaction for logs/outbox payloads. | Redaction utility and tests. | Security review. |
| P4-HARD-04 | TODO | Add prompt injection red-team suite. | Operator input + MCP data injection cases. | Test suite pass. |
| P4-HARD-05 | TODO | Add model pinning and drift guard. | Adapter config records model version and schema hash. | Unit tests. |
| P4-HARD-06 | TODO | Add chaos tests. | Crash before lease, during LLM, after prepare, before finalize, during publisher emit. | Integration test report. |
| P4-HARD-07 | TODO | Add admin recovery tooling. | Restricted force-clear/dead-letter replay endpoints if approved. | Security review. |

Exit gate: hardening tests pass and SRE/compliance review accepts runbook.

## P5-CANARY-READONLY — Consultazione Flow

| Task ID | Status | Task | Deliverable | Gate |
|---|---|---|---|---|
| P5-READ-01 | TODO | Create/confirm consultazione fixture with `useCommandLayer=true`. | Read-only fixture and golden turns. | Deterministic benchmark pass. |
| P5-READ-02 | TODO | Run shadow sessions. | Compare legacy vs command layer outputs. | Report approved. |
| P5-READ-03 | TODO | Internal 5% canary. | Feature flag rollout and monitoring dashboard. | 7-day metrics. |
| P5-READ-04 | TODO | Canary exit review. | Latency, error, policy rejection, replay, operator feedback. | Product/engineering sign-off. |

Exit gate: no data-loss defects, no unresolved critical bugs, p95 and error rates within accepted thresholds.

## P6-CANARY-DISPOSITIVO — Estinzione Flow

| Task ID | Status | Task | Deliverable | Gate |
|---|---|---|---|---|
| P6-DISP-01 | TODO | Stage dispositive flow with synthetic data. | Estinzione fixture and mock MCP tools. | E2E staging pass. |
| P6-DISP-02 | TODO | Operator shadow test. | 30+ real operator sessions in staging. | Compliance/product review. |
| P6-DISP-03 | TODO | Validate manual fallback and kill switch. | Runbook and drill evidence. | SRE sign-off. |
| P6-DISP-04 | TODO | Production canary 10%. | Monitored rollout. | 48h stability. |
| P6-DISP-05 | TODO | Production canary 50%. | Expanded rollout. | 48h stability. |
| P6-DISP-06 | TODO | Production 100%. | Full rollout. | 2-week stability window. |

Exit gate: compliance sign-off, SRE sign-off, and stable metrics through full rollout.

## P7-SUNSET — Legacy Retirement

| Task ID | Status | Task | Deliverable | Gate |
|---|---|---|---|---|
| P7-SUN-01 | TODO | Freeze legacy path after Phase 2. | No new flow templates with `useCommandLayer=false`. | Review policy. |
| P7-SUN-02 | TODO | Track legacy usage. | Dashboard of legacy sessions/flows. | 0 critical legacy-only users. |
| P7-SUN-03 | TODO | Remove legacy endpoint after sunset. | Remove `/field-extract` if no longer used. | Full test suite pass. |
| P7-SUN-04 | TODO | Remove duplicate code paths. | Remove absorbed meta/question/extraction duplicate pieces. | Regression tests. |
| P7-SUN-05 | TODO | Final docs update. | Architecture docs and runbooks reflect final system. | Docs review. |

## Test Strategy By Layer

| Layer | Status | Required Tests |
|---|---|---|
| Shared contracts | TODO | Schema parse/fail tests for commands, events, DTOs, pending_cancel, settings compatibility. |
| API unit | TODO | Provider adapter mock, prompt builder, policy engine, dispatcher, info renderer, pre-resolvers, saga services. |
| API integration | TODO | Store-entry CAS 200/412, turn-log lease, finalize/rollback, outbox publisher, recovery daemon, PostgreSQL-only guard. |
| Engine unit | TODO | Turn interpreter client, adapters, apply-turn-result, sessionStore CAS, topic-change reset, first-turn catalogReadiness. |
| Engine integration | TODO | Legacy path unchanged, command path pause/resume, overwrite, cancel, catalog failure, DAG failure, CAS conflict. |
| Frontend unit | TODO | Turn event hook/reducer, dedupe, ordering, gap/replay, timeline rendering. |
| Playwright | TODO | Existing interactive-flow scenarios plus command-layer read-only and cancel/overwrite flows. |
| Chaos/concurrency | TODO | Same turnId concurrency, stale lease, stale commit, T1 prepared crash, T2 CAS fail, publisher duplicate/reorder, recovery timeout. |

## Required Command Set Before Release Candidate

Run from `activepieces-fork` unless specified.

```bash
npm run lint-dev
npm run test-unit
npm run test-api
npm run check-migrations
cd packages/server/engine && npm run test:coverage
cd packages/shared && npm run test
cd packages/web && npm run test && npm run typecheck
AP_EDITION=ce npm run test:e2e -- packages/tests-e2e/scenarios/ce/flows/interactive-flow.local.spec.ts packages/tests-e2e/scenarios/ce/flows/interactive-flow-canvas.local.spec.ts
```

For real LLM benchmark runs, require explicit credentials and an opt-in env flag. These must never be required for default CI.

## Open Decisions Tracked In Phase 0A

| Decision ID | Status | Decision | Needed By |
|---|---|---|---|
| D-ENTITY-NAMING | TODO | CamelCase DB columns vs snake_case + `name` mapping. | P0A-INFRA-01 |
| D-SEQUENCE-TYPE | TODO | `sessionSequence` shared type: string bigint vs safe number with hard cap. | P0B-CONTRACT-02 |
| D-CAS-ENDPOINT | TODO | Extend current store-entry POST or add dedicated CAS route. | P0A-INFRA-13 |
| D-SQLITE-BEHAVIOR | TODO | Validation-time failure vs runtime failure for `useCommandLayer=true` on non-PostgreSQL. | P0A-INFRA-06 |
| D-RETENTION | TODO | Outbox/turn-log retention duration and cleanup policy. | P4-HARD-07 |
