# Canary Rollout — Command Layer

**Audience**: SRE / on-call when rolling `useCommandLayer: true` to staging
+ prod.

**Pre-conditions**:
- staging + prod environments available
- Linear access (ticket creation for incidents)
- Grafana dashboards `command-layer-overview` + `interactive-flow-runs`
- Feature-flag toggle (currently per-flow `settings.useCommandLayer`)

## Phase 1 — Read-only validation (consultazione)

1. Deploy branch `feature/command-layer-p0b-infra` to staging.
2. Enable `useCommandLayer: true` only on the consultazione (read-only)
   flow.
3. Monitor 24h on Grafana:
   - `command_layer_outboxError` rate < 0.1% of `outboxPublished`
   - p95 of `turn-interpreter.interpret` span < 2× baseline
     (target < 800ms)
   - Zero `prepared` turns lingering past 5 minutes
     (`SELECT count(*) FROM "interactive_flow_turn_log"
      WHERE status='prepared' AND createdAt < NOW() - interval '5 min'`)
4. **Pass**: proceed to Phase 2.
   **Fail**: revert via `useCommandLayer: false` flag flip → no
   redeploy needed; legacy field-extractor resumes the flow.

## Phase 2 — Estinzione canary 5%

1. Set platform feature flag rollout to 5% on the estinzione flow.
2. Monitor 48h:
   - same p95 / error-rate gates
   - `command_layer_casConflict` count stays low (< 0.5% of total
     interpret-turn calls)
3. **Step up**:
   - Day 3: 25% rollout, monitor 48h
   - Day 5: 50% rollout, monitor 72h
   - Day 8: 100% rollout, monitor 7 days
4. **Rollback**: any phase regression → flag back to 0%.

## Phase 3 — Sunset legacy field-extractor

1. After 30 days of full prod stability:
   - Mark `field-extractor.ts` `@deprecated` in JSDoc.
   - Add a planned-removal note in
     `docs/interactive-flow/solution-final-v3.3.md`.
2. After 60 additional days (90 days post-100%):
   - Remove the legacy code path from
     `packages/server/engine/src/lib/handler/turn-interpreter-adapter.ts`
     (drop `legacyFieldExtractorAdapter` + `selectAdapter` always
     returns `commandLayerClientAdapter`).
   - Drop `field-extractor.ts`.
3. Final: archive sunset checklist
   ([sunset-checklist.md](sunset-checklist.md)) with the prod date.

## Rapid rollback path

- **Per-flow**: edit step settings → `useCommandLayer: false` →
  publish. The validator
  ([interactive-flow-validator.ts](../../packages/server/api/src/app/flows/flow-version/interactive-flow-validator.ts))
  accepts the change instantly; legacy resumes within seconds.
- **Platform-wide**: feature flag `command-layer-canary` → 0% →
  publishes flush via the canary-flag listener.
- **Prepared turn drain**: `lockRecoveryDaemon` reclaims any in-flight
  prepared turns within ~5 minutes (
  [lock-recovery.ts](../../packages/server/api/src/app/ai/command-layer/lock-recovery.ts))
  → state remains consistent (compensated/finalize-timeout).

## Observability checklist

- Grafana panel `command_layer_outboxPublished` matches incoming
  TURN_COMMITTED events on `interactive_flow_turn_log` (status=
  `finalized`).
- `command_layer_outboxRetry` baseline < 1/min in nominal load.
- `command_layer_leaseConflict` indicates concurrent worker contention
  — should remain near 0 with `lockRecoveryDaemon` healthy.
- `/metrics?format=prometheus` (H-03) is scraped by Prometheus every
  30s.

## Simulation evidence

A simulation test
([command-layer-canary-simulation.test.ts](../../packages/server/api/test/integration/ce/ai/command-layer-canary-simulation.test.ts))
exercises the rollout/rollback gates in-process: variable percentage
gating, error-rate spike rollback, prepared-turn recovery via lock
daemon, and metrics observation.
