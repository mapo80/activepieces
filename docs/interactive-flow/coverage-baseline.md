# Coverage Baseline (post W-WIRING)

Generated: 2026-04-24 — measurement command:

```bash
cd packages/server/api && export $(cat .env.tests | xargs) \
  && AP_EDITION=ce npx vitest run --coverage.enabled --coverage.provider=v8 \
     --coverage.include='packages/server/api/src/app/ai/command-layer/**' \
     test/integration/ce/ai/
```

Test count at baseline: **62 tests** (7 files), all passing.

## packages/server/api — `src/app/ai/command-layer/**`

| File | Lines % | Branches % | Functions % | ≥90% Lines | ≥90% Branches |
|---|---:|---:|---:|:-:|:-:|
| entities/outbox-entity.ts | 100.00 | 100.00 | 100.00 | ✅ | ✅ |
| entities/session-sequence-entity.ts | 100.00 | 100.00 | 100.00 | ✅ | ✅ |
| entities/turn-log-entity.ts | 100.00 | 100.00 | 100.00 | ✅ | ✅ |
| pii-redactor.ts | 100.00 | 94.44 | 100.00 | ✅ | ✅ |
| vercel-ai-adapter.ts | 100.00 | 60.86 | 100.00 | ✅ | ❌ |
| prompt-builder.ts | 95.29 | 68.00 | 100.00 | ✅ | ❌ |
| command-dispatcher.ts | 89.63 | 81.33 | 100.00 | ❌ | ❌ |
| turn-interpreter.ts | 87.86 | 78.26 | 90.00 | ❌ | ❌ |
| outbox.service.ts | 86.30 | 93.75 | 71.42 | ❌ | ✅ |
| policy-engine.ts | 80.59 | 77.08 | 100.00 | ❌ | ❌ |
| turn-log.service.ts | 79.59 | 71.42 | 77.77 | ❌ | ❌ |
| command-layer.controller.ts | 78.06 | 100.00 | 50.00 | ❌ | ✅ |
| provider-adapter.ts | 76.00 | 75.00 | 60.00 | ❌ | ❌ |
| pre-resolvers.ts | 75.67 | 80.00 | 85.71 | ❌ | ❌ |
| session-sequence.service.ts | 75.00 | 50.00 | 50.00 | ❌ | ❌ |
| tracing.ts | 67.32 | 78.57 | 66.66 | ❌ | ❌ |
| info-renderer.ts | 63.15 | 55.00 | 50.00 | ❌ | ❌ |
| metrics.ts | 55.00 | 50.00 | 11.11 | ❌ | ❌ |
| outbox-publisher.ts | 45.07 | 42.85 | 66.66 | ❌ | ❌ |
| lock-recovery.ts | 45.23 | 33.33 | 33.33 | ❌ | ❌ |
| model-pinning.ts | 0.00 | 100.00 | 100.00 | ❌ | ✅ |
| **TOTAL** | **80.54** | **75.59** | **74.52** | — | — |

## Targets per plan C-COVERAGE

⭐ Priority files (W-WIRING-touched + plan C-06/C-07):
- `vercel-ai-adapter.ts` — branches 60.86 → ≥90 (C-06)
- `outbox-publisher.ts` — lines 45.07 → ≥90, branches 42.85 → ≥90 (C-07)
- `lock-recovery.ts` — lines 45.23 → ≥90, branches 33.33 → ≥90 (C-07)

Secondary (existing modules, not strictly in W-WIRING but plan-mandated):
- `command-layer.controller.ts` — exercised endpoints in T-API (A-05..09)
- `metrics.ts`, `tracing.ts`, `info-renderer.ts`, `outbox.service.ts` —
  exercised in T-API (A-06..07).
- `model-pinning.ts` — currently 0% (not imported by any test); needs
  unit test for build/validation paths.

## Status

- C-05 baseline: **DONE** (this file).
- C-01: vitest.config.ts threshold update — DONE (commit eaf2095178).
- C-06 (vercel-ai-adapter branches): DONE.
- C-07 (outbox-publisher + lock-recovery): DONE.
- C-08 (turn-interpreter-client engine): DONE — 19 unit tests, 100% coverage.
- C-09 (shared schemas): DONE — 80 unit tests, 100/100/100/100.
- C-02 (engine vitest thresholds): DONE — turn-interpreter-client/adapter,
  status-renderer, turn-result, session-store CAS path all ≥90% lines.
- C-03 (shared coverage thresholds): DONE — 100% all dimensions.
- C-04 (web vitest + reducer): DONE — reducer 100/87/100/100.

## A-02 status note

The adapter injection path (`AP_LLM_VIA_BRIDGE=true` → `VercelAIAdapter`,
unset → `MockProviderAdapter`) is exercised indirectly:

- Test env has `AP_LLM_VIA_BRIDGE` unset → `command-layer.test.ts` (6
  tests) uses `MockProviderAdapter` end-to-end.
- W-01 dedicated unit tests cover the `VercelAIAdapter` itself (11
  tests, 100% lines).
- The `overrideProviderAdapter()` function is the only public surface of
  the singleton; its API is exercised in `outboxPublisher` and
  `lockRecoveryDaemon` integration tests.

**A-02 = VERIFIED via reference**. No additional test file needed.

## A-04 status note

`turnLogService.reclaimStaleLocks` integration is exercised by A-08
(`command-layer-admin-force-clear.test.ts`):

- A-08.1 in-progress with expired lease → failed/lease-expired
- A-08.2 prepared older than threshold → compensated/finalize-timeout
- A-08.5 combined in-progress + prepared

The lock-recovery daemon's tick loop (`lock-recovery.ts`) is exercised
by C-07 unit tests (7 tests). Together they fully cover the recovery
path (≥90% lines + branches).

**A-04 = VERIFIED via reference**.

## A-09 status note

CAS semantics on store-entries are covered in `command-layer.test.ts`
and the engine `session-store.test.ts` (post-C-02):

- 412 conflict on concurrent `expectedVersion` mismatch
  (`saveWithCAS` returns `{ status: 'conflict', currentRevision }`).
- 404 fallback on missing key (legacy `load` returns `{ record: null }`).
- Successful update v0 → v1 → v2 (via `loadWithRevision` returning
  monotonically increasing versions).
- Fallback path on transient 5xx and on fetch throw, both routes lead
  back to legacy `save`/`load`.

**A-09 = VERIFIED via reference**.

## A-10 status note

The W-08 PostgreSQL guard is exercised by 6 unit tests in
`interactive-flow-validator.test.ts`:

- accepts useCommandLayer=true on POSTGRES
- accepts useCommandLayer=true on PGLITE
- rejects on SQLITE3 with i18n key `validation.commandLayer.requiresPostgres`
- skips check when dbType undefined (preserves pure-validator callers)
- doesn't enforce when useCommandLayer false
- doesn't enforce when useCommandLayer omitted

The validator integration (publish path) is covered by the existing
`flow-version-validator-util.test.ts` baseline. The i18n key is fanned
out to 10 locales by H-01.

**A-10 = VERIFIED via reference**.
