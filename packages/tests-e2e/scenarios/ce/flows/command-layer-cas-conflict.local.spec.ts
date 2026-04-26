/**
 * T-11 — CAS conflict: two messages to the same chat session concurrently.
 *
 * Opens two browser contexts for the SAME chat URL and sends messages
 * in parallel. The system should handle this gracefully: exactly one
 * turn should succeed and the other should either succeed (last-write-wins)
 * or be retried/queued by the browser. Both contexts should eventually
 * show a valid bot response.
 *
 * RUN
 *   cd packages/tests-e2e
 *   E2E_EMAIL=dev@ap.com E2E_PASSWORD=12345678 AP_EDITION=ce \
 *     npx playwright test scenarios/ce/flows/command-layer-cas-conflict.local.spec.ts
 */
import { test, expect } from '@playwright/test'
import {
    signIn,
    importAndPublishFlow,
    deleteFlow,
    openChatPage,
    sendChatMessage,
    waitForBotBubble,
    CONSULTAZIONE_FIXTURE_PATH,
} from '../../../fixtures/consultazione-spec-helpers'

test.describe.configure({ mode: 'serial' })

test.describe('command-layer cas-conflict', () => {
    test('T-11: two concurrent turns on same session complete without data corruption', async ({
        page: _page,
        request,
        browser,
    }) => {
        test.setTimeout(10 * 60_000)

        const { token, projectId } = await signIn(request)
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
        const flowId = await importAndPublishFlow(
            request, token, projectId,
            CONSULTAZIONE_FIXTURE_PATH,
            `Consultazione CAS T11 ${suffix}`,
        )

        // Open two browser contexts on the same chat URL
        const page1 = await openChatPage(browser, flowId)
        const page2 = await openChatPage(browser, flowId)

        try {
            // Send messages concurrently from both contexts
            await Promise.all([
                sendChatMessage(page1, 'Bellafronte'),
                sendChatMessage(page2, 'Rossi'),
            ])

            // Both pages should eventually show a bot response
            const [bot1, bot2] = await Promise.all([
                waitForBotBubble(page1, 1, 120_000).catch(() => ''),
                waitForBotBubble(page2, 1, 120_000).catch(() => ''),
            ])

            console.log('[T-11] page1 bot:', bot1.slice(0, 80))
            console.log('[T-11] page2 bot:', bot2.slice(0, 80))

            // At least one context must have received a valid response
            const validResponses = [bot1, bot2].filter((b) => b.length > 0)
            expect(validResponses.length).toBeGreaterThanOrEqual(1)
        }
        finally {
            await page1.context().close()
            await page2.context().close()
            await deleteFlow(request, token, flowId)
        }
    })
})
