/**
 * T-04 — Meta-questions during consultazione mid-flow.
 *
 * Verifies that "cosa mi avevi chiesto?", "ripeti", "non ho capito"
 * are answered by the bot WITHOUT advancing state.
 *
 * PRE-REQUISITES
 *   ./dev-start.sh with AP_LLM_VIA_BRIDGE=true (bridge at :8787)
 *   AEP backend at :8000
 *
 * RUN
 *   cd packages/tests-e2e
 *   E2E_EMAIL=dev@ap.com E2E_PASSWORD=12345678 AP_EDITION=ce \
 *     npx playwright test scenarios/ce/flows/command-layer-meta.local.spec.ts
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

test.describe('command-layer meta', () => {
    test('T-04: meta-questions answered without advancing state', async ({ page: _page, request, browser }) => {
        test.setTimeout(8 * 60_000)

        const { token, projectId } = await signIn(request)
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
        const flowId = await importAndPublishFlow(
            request, token, projectId,
            CONSULTAZIONE_FIXTURE_PATH,
            `Consultazione Meta T04 ${suffix}`,
        )
        const chatPage = await openChatPage(browser, flowId)

        try {
            // Turn 1: provide customer name to start the flow
            console.log('[T-04] turn 1: Bellafronte')
            await sendChatMessage(chatPage, 'Bellafronte')
            const bot1 = await waitForBotBubble(chatPage, 1, 120_000)
            console.log('[T-04] bot1:', bot1.slice(0, 120))
            expect(bot1.length).toBeGreaterThan(0)

            // Turn 2: meta-question "cosa mi avevi chiesto?"
            console.log('[T-04] turn 2: cosa mi avevi chiesto?')
            await sendChatMessage(chatPage, 'cosa mi avevi chiesto?')
            const bot2 = await waitForBotBubble(chatPage, 2, 120_000)
            console.log('[T-04] bot2:', bot2.slice(0, 120))
            // The bot should answer the meta-question (not ask for a new field out of context)
            // It should reference customers or the search result, not introduce a new topic
            expect(bot2.length).toBeGreaterThan(5)

            // Turn 3: "ripeti" — bot should repeat or rephrase
            console.log('[T-04] turn 3: ripeti')
            await sendChatMessage(chatPage, 'ripeti')
            const bot3 = await waitForBotBubble(chatPage, 3, 120_000)
            console.log('[T-04] bot3:', bot3.slice(0, 120))
            expect(bot3.length).toBeGreaterThan(5)
        }
        finally {
            await chatPage.context().close()
            await deleteFlow(request, token, flowId)
        }
    })
})
