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

    test.skip('happy path: send Bellafronte → field extracted via real LLM', async ({ page: _ }) => {
        // TODO (env-bound, on-call):
        // 1. open chat for fixture estinzione
        // 2. send "Bellafronte"
        // 3. expect bot message containing "📝" and "customerName"
        // 4. assert turn-log status === finalized via DB query
    })

    test.skip('cancel flow: "annulla" → CANCEL_REQUESTED + confirm path', async ({ page: _ }) => {
        // TODO: open estinzione fixture; sendUserMessage("annulla");
        // expectActionTrace(['CANCEL_REQUESTED']); confirm with "sì";
        // assert state reset and bot message contains cancellation copy.
    })
})
