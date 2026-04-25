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
- C-01: vitest.config.ts threshold update — pending after C-06/07/08/09.
- C-06 (vercel-ai-adapter branches): pending.
- C-07 (outbox-publisher + lock-recovery): pending.
- C-08 (turn-interpreter-client engine): pending.
- C-09 (shared schemas): pending.
