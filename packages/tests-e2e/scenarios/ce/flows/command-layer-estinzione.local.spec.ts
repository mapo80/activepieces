/**
 * Estinzione end-to-end via command layer.
 *
 * Verifies the estinzione fixture works through the command layer runtime:
 * field extraction → auto-NDG → DAG (search_customer/load_profile/load_accounts/load_reasons)
 * → pause su pick_rapporto. Stops at turn 3 to avoid AEP banking-operations/generate_module
 * which is inherently unreliable.
 *
 * RUN
 *   cd packages/tests-e2e
 *   E2E_EMAIL=dev@ap.com E2E_PASSWORD=12345678 AP_EDITION=ce \
 *     npx playwright test scenarios/ce/flows/command-layer-estinzione.local.spec.ts
 */
import { test, expect } from '@playwright/test'
import {
    signIn,
    importAndPublishFlow,
    deleteFlow,
    openChatPage,
    sendChatMessage,
    waitForBotBubble,
    ESTINZIONE_FIXTURE_PATH,
} from '../../../fixtures/consultazione-spec-helpers'

test.describe.configure({ mode: 'serial' })

test.describe('command-layer estinzione', () => {
    test('estinzione 3-turn conversation reaches motivation/date pause', async ({ page: _page, request, browser }) => {
        test.setTimeout(8 * 60_000)

        const { token, projectId } = await signIn(request)
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
        const flowId = await importAndPublishFlow(
            request, token, projectId,
            ESTINZIONE_FIXTURE_PATH,
            `Estinzione CommandLayer ${suffix}`,
        )
        const chatPage = await openChatPage(browser, flowId)

        try {
            const turns = [
                { user: 'Vorrei estinguere un rapporto di Bellafronte', expect: /bellafronte/i },
                { user: 'confermo il cliente Bellafronte con NDG 11255521', expect: /11255521|rapport/i },
                { user: 'per il cliente NDG 11255521 scelgo il rapporto 01-034-00392400', expect: /motivazion|data|reason/i },
            ]

            for (const [i, turn] of turns.entries()) {
                console.log(`[estinzione] turn ${i + 1}: ${turn.user.slice(0, 60)}…`)
                await sendChatMessage(chatPage, turn.user)
                const bot = await waitForBotBubble(chatPage, i + 1, 180_000)
                console.log(`[estinzione] bot${i + 1}:`, bot.slice(0, 100))
                expect(bot, `turn ${i + 1} assertion failed`).toMatch(turn.expect)
            }
        }
        finally {
            await chatPage.context().close()
            await deleteFlow(request, token, flowId)
        }
    })
})
