/**
 * DEV-03 status: Playwright spec marked as fixme.
 *
 * The scenario is functionally covered by the API-level integration tests
 * in `packages/server/api/test/integration/ce/ai/` (turn-interpreter,
 * publisher-integration, finalize-rollback, cross-flow, store-cas suites
 * — 140 tests as of post-DEV-04). The dev-stack live execution (real UI
 * + WS frames + DB query loop) is on-call territory:
 *
 *   1. Start bridge: `cd ../claude-code-openai-bridge && npm run dev`
 *   2. Set `AP_TEST_DATABASE_URL=postgresql://...` for `readDbTurnLog` /
 *      `readDbOutbox` helpers
 *   3. Run dev-stack with `AP_LLM_VIA_BRIDGE=true npm run dev`
 *   4. Remove `.fixme` from this file's describe + per-test, fill in the
 *      TODO body using helpers from `chat-runtime-helpers.ts`
 *   5. Run with `AP_EDITION=ce npx playwright test <this-file>`
 *
 * The DB helpers (readDbTurnLog/readDbOutbox) ARE implemented (DEV-03
 * commit) — they require a Postgres connection string + the `pg` package.
 */
import { test, expect } from '@playwright/test'

const BRIDGE_REQUIRED = process.env.AP_LLM_VIA_BRIDGE === 'true'

test.describe('command-layer bridge smoke (opt-in)', () => {
    test.beforeAll(async () => {
        if (!BRIDGE_REQUIRED) {
            test.skip()
            return
        }
        const res = await fetch('http://localhost:8787/health').catch(() => null)
        expect(res?.status).toBe(200)
    })

    test.fixme('happy path: send Bellafronte → field extracted via real LLM', async ({ page: _ }) => {
        // TODO (env-bound, on-call):
        // 1. open chat for fixture estinzione
        // 2. send "Bellafronte"
        // 3. expect bot message containing "📝" and "customerName"
        // 4. assert turn-log status === finalized via DB query
    })

    test.fixme('cancel flow: "annulla" → CANCEL_REQUESTED + confirm path', async ({ page: _ }) => {
        // TODO: open estinzione fixture; sendUserMessage("annulla");
        // expectActionTrace(['CANCEL_REQUESTED']); confirm with "sì";
        // assert state reset and bot message contains cancellation copy.
    })
})
