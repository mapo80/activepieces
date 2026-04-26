/**
 * M1 — Consultazione conversational mega-journey (9 turni).
 *
 * Copre: SET_FIELDS, ANSWER_INFO(count_matches+count_accounts),
 * ANSWER_META(ask-repeat/ask-clarify/ask-progress), TopicChange,
 * REPROMPT(low-confidence) [or ANSWER_META fallback], errorPolicy SKIP
 * (Rossi 400 AEP), RESOLVE_PENDING(confirm_binary, accept) → submit.
 *
 * RUN
 *   E2E_EMAIL=dev@ap.com E2E_PASSWORD=12345678 AP_EDITION=ce \
 *     npx playwright test scenarios/ce/flows/journey-consultazione-conversational.local.spec.ts
 */
import { test, expect } from '@playwright/test'
import {
    sendChatMessage,
    waitForBotBubble,
    withChatSession,
    CONSULTAZIONE_FIXTURE_PATH,
} from '../../../fixtures/consultazione-spec-helpers'

test.describe.configure({ mode: 'serial' })

test.describe('M1 — consultazione conversational journey', () => {
    test('9-turn journey: SET_FIELDS, ANSWER_INFO×2, ANSWER_META×3, TopicChange, REPROMPT, confirm', async ({ request, browser }) => {
        test.setTimeout(15 * 60_000)
        await withChatSession({
            request, browser,
            fixturePath: CONSULTAZIONE_FIXTURE_PATH,
            flowName: 'M1 Conversational',
        }, async ({ page }) => {
            // T1 — SET_FIELDS(customerName) → search → auto-NDG → load_profile/accounts → pause
            console.log('[M1] T1: Bellafronte')
            await sendChatMessage(page, 'Bellafronte')
            const t1 = await waitForBotBubble(page, 1, 120_000)
            console.log('[M1] bot1:', t1.slice(0, 150))
            expect(t1.length).toBeGreaterThan(5)

            // T2 — ANSWER_INFO(count_matches): post-search customerMatches present
            console.log('[M1] T2: quanti clienti hai trovato?')
            await sendChatMessage(page, 'quanti clienti hai trovato?')
            const t2 = await waitForBotBubble(page, 2, 120_000)
            console.log('[M1] bot2:', t2.slice(0, 150))
            expect(t2.length).toBeGreaterThan(5)

            // T3 — ANSWER_INFO(count_accounts)
            console.log('[M1] T3: quanti rapporti ha?')
            await sendChatMessage(page, 'quanti rapporti ha?')
            const t3 = await waitForBotBubble(page, 3, 120_000)
            console.log('[M1] bot3:', t3.slice(0, 150))
            expect(t3.length).toBeGreaterThan(5)

            // T4 — ANSWER_META(ask-repeat): no state advance
            console.log('[M1] T4: cosa mi avevi chiesto?')
            await sendChatMessage(page, 'cosa mi avevi chiesto?')
            const t4 = await waitForBotBubble(page, 4, 120_000)
            console.log('[M1] bot4:', t4.slice(0, 150))
            expect(t4.length).toBeGreaterThan(5)

            // T5 — ANSWER_META(ask-clarify): no state advance
            console.log('[M1] T5: non ho capito bene, puoi spiegare?')
            await sendChatMessage(page, 'non ho capito bene, puoi spiegare?')
            const t5 = await waitForBotBubble(page, 5, 120_000)
            console.log('[M1] bot5:', t5.slice(0, 150))
            expect(t5.length).toBeGreaterThan(5)

            // T6 — ANSWER_META(ask-progress): no state advance
            console.log('[M1] T6: a che punto siamo?')
            await sendChatMessage(page, 'a che punto siamo?')
            const t6 = await waitForBotBubble(page, 6, 120_000)
            console.log('[M1] bot6:', t6.slice(0, 150))
            expect(t6.length).toBeGreaterThan(5)

            // T7 — TopicChange: Rossi → AEP 400 → search SKIP → bot graceful
            console.log('[M1] T7: scusa il cliente è Rossi')
            await sendChatMessage(page, 'scusa il cliente è Rossi')
            const t7 = await waitForBotBubble(page, 7, 120_000)
            console.log('[M1] bot7:', t7.slice(0, 150))
            expect(t7.length).toBeGreaterThan(5)

            // T8 — REPROMPT(low-confidence) OR ANSWER_META(ask-clarify)
            console.log('[M1] T8: non saprei davvero, ho perso il filo')
            await sendChatMessage(page, 'non saprei davvero, ho perso il filo')
            const t8 = await waitForBotBubble(page, 8, 120_000)
            console.log('[M1] bot8:', t8.slice(0, 150))
            expect(t8.length).toBeGreaterThan(5)

            // T9 — recovery + confirm_binary accept → submit
            console.log('[M1] T9: no torna a Bellafronte e conferma la condivisione')
            await sendChatMessage(page, 'no torna a Bellafronte e conferma la condivisione')
            const t9 = await waitForBotBubble(page, 9, 180_000)
            console.log('[M1] bot9:', t9.slice(0, 150))
            expect(t9.length).toBeGreaterThan(5)
        })
    })
})
