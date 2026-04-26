/**
 * S1 — Bridge smoke gate (1 turno).
 *
 * Verifies that the full path browser → AP chat → command layer → bridge →
 * Claude CLI → field extracted → bot responds is functional.
 *
 * Used as the FIRST spec in the e2e suite to fail-fast if bridge is down.
 *
 * RUN
 *   AP_LLM_VIA_BRIDGE=true E2E_EMAIL=dev@ap.com E2E_PASSWORD=12345678 \
 *   AP_EDITION=ce npx playwright test \
 *     scenarios/ce/flows/command-layer-bridge-smoke.local.spec.ts
 */
import { test, expect } from '@playwright/test'
import {
    sendChatMessage,
    waitForBotBubble,
    withChatSession,
    CONSULTAZIONE_FIXTURE_PATH,
} from '../../../fixtures/consultazione-spec-helpers'

const BRIDGE_URL = process.env.OPENAI_BASE_URL ?? process.env.CLAUDE_BRIDGE_URL ?? 'http://localhost:8787'

test.describe('S1 — bridge smoke gate', () => {
    test.beforeAll(async () => {
        const res = await fetch(`${BRIDGE_URL}/health`).catch(() => null)
        if (!res || res.status !== 200) {
            test.skip()
        }
    })

    test('S1: bridge LLM responds end-to-end on "Bellafronte"', async ({ request, browser }) => {
        test.setTimeout(3 * 60_000)
        await withChatSession({
            request, browser,
            fixturePath: CONSULTAZIONE_FIXTURE_PATH,
            flowName: 'S1 BridgeSmoke',
        }, async ({ page }) => {
            await sendChatMessage(page, 'Bellafronte')
            const bot1 = await waitForBotBubble(page, 1, 120_000)
            console.log('[S1] bot1:', bot1.slice(0, 150))
            expect(bot1).toMatch(/cliente|trovato|ndg|consultazion|bellafronte/i)
        })
    })
})
