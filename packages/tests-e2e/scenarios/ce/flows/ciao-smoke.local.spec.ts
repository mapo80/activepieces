/**
 * ciao smoke — minimal e2e test for "ciao" greeting handling.
 *
 * Verifies the bot responds to a generic non-extractable greeting on the
 * consultazione fixture. Expected behavior: bot should respond (REPROMPT,
 * ANSWER_META, or extraction request) — NOT hang forever in "loading".
 *
 * RUN
 *   AP_LLM_VIA_BRIDGE=true E2E_EMAIL=dev@ap.com E2E_PASSWORD=12345678 \
 *   AP_EDITION=ce npx playwright test \
 *     scenarios/ce/flows/ciao-smoke.local.spec.ts
 */
import { test, expect } from '@playwright/test'
import {
    sendChatMessage,
    waitForBotBubble,
    withChatSession,
    CONSULTAZIONE_FIXTURE_PATH,
} from '../../../fixtures/consultazione-spec-helpers'

test.describe('ciao smoke', () => {
    test('bot responds to "ciao" within 60s (no hang)', async ({ request, browser }) => {
        test.setTimeout(3 * 60_000)
        await withChatSession({
            request, browser,
            fixturePath: CONSULTAZIONE_FIXTURE_PATH,
            flowName: 'CiaoSmoke',
        }, async ({ page }) => {
            await sendChatMessage(page, 'ciao')
            const bot = await waitForBotBubble(page, 1, 60_000)
            console.log('[ciao-smoke] bot:', bot.slice(0, 200))
            expect(bot.length).toBeGreaterThan(5)
        })
    })
})
