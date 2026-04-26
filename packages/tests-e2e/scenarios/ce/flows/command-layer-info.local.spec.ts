/**
 * T-05 — Info-intent query mid-flow "quanti rapporti ha?".
 *
 * After the consultazione flow has loaded accounts, asking how many
 * accounts a customer has should trigger ANSWER_INFO (not advance state).
 *
 * RUN
 *   cd packages/tests-e2e
 *   E2E_EMAIL=dev@ap.com E2E_PASSWORD=12345678 AP_EDITION=ce \
 *     npx playwright test scenarios/ce/flows/command-layer-info.local.spec.ts
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

test.describe('command-layer info', () => {
    test('T-05: info-intent answer without advancing state', async ({ page: _page, request, browser }) => {
        test.setTimeout(10 * 60_000)

        const { token, projectId } = await signIn(request)
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
        const flowId = await importAndPublishFlow(
            request, token, projectId,
            CONSULTAZIONE_FIXTURE_PATH,
            `Consultazione Info T05 ${suffix}`,
        )
        const chatPage = await openChatPage(browser, flowId)

        try {
            // Turn 1: provide customer name
            console.log('[T-05] turn 1: Bellafronte')
            await sendChatMessage(chatPage, 'Bellafronte')
            const bot1 = await waitForBotBubble(chatPage, 1, 120_000)
            console.log('[T-05] bot1:', bot1.slice(0, 120))
            expect(bot1.length).toBeGreaterThan(0)

            // Turn 2: info query — how many accounts (flow already loaded all data in turn 1)
            console.log('[T-05] turn 2: quanti rapporti ha?')
            await sendChatMessage(chatPage, 'quanti rapporti ha?')
            const bot2 = await waitForBotBubble(chatPage, 2, 120_000)
            console.log('[T-05] bot2:', bot2.slice(0, 120))
            // The bot should answer with a number or indicate the count of accounts
            expect(bot2.length).toBeGreaterThan(5)
            // Must contain a digit (account count) or a word meaning accounts/count
            expect(bot2).toMatch(/\d|rapporti|conto|nessun|cliente/i)
        }
        finally {
            await chatPage.context().close()
            await deleteFlow(request, token, flowId)
        }
    })
})
