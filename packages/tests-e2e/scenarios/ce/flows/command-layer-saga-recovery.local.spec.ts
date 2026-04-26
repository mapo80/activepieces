/**
 * T-12 — Saga recovery: kill API mid-prepared turn → lockRecoveryDaemon compensates.
 *
 * This test requires a SIGKILL seam to terminate the API process mid-turn,
 * which is architecturally difficult in the current dev-stack (single process,
 * PGLite, no process-group isolation). The underlying recovery logic IS tested
 * via the vitest chaos suite (command-layer-chaos.test.ts: "prepared zombie
 * reclaim" — turnLogService.reclaimStaleLocks compensates stale prepared rows).
 *
 * Keeping as `test.fixme` until a process-kill seam is available.
 */
import { test, expect } from '@playwright/test'

test.describe('command-layer saga-recovery', () => {
    test.fixme(
        'T-12: API restart → stale prepared turn compensated by lockRecoveryDaemon',
        async () => {
            // Architectural constraint: requires SIGKILL to the worker process
            // mid-turn, which is not safely achievable in the current single-process
            // PGLite dev-stack. Recovery IS validated in:
            //   packages/server/api/test/integration/ce/ai/command-layer-chaos.test.ts
            //   "prepared zombie reclaim: stale prepared (>5 min) is compensated"
            expect(true).toBe(true) // placeholder
        },
    )
})
