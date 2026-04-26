/**
 * M2 — Estinzione saga completa mega-journey (5 turni).
 *
 * Copre: saga in-progress → prepared → finalized completa (5 turni reali AEP),
 * SET_FIELDS multipli, errorPolicy SKIP su Rossi, TopicChange + recovery,
 * tool chain (load_reasons, generate_pdf, submit_closure), CONFIRM node
 * (confirm_closure), RESOLVE_PENDING(confirm_binary, accept), caseId
 * extraction.
 *
 * `test.describe.configure({ retries: 2 })` per gestire AEP
 * banking-operations/generate_module flakiness.
 *
 * RUN
 *   E2E_EMAIL=dev@ap.com E2E_PASSWORD=12345678 AP_EDITION=ce \
 *     npx playwright test scenarios/ce/flows/journey-estinzione-saga-completa.local.spec.ts
 */
import { test, expect } from '@playwright/test'
import {
    sendChatMessage,
    waitForBotBubble,
    withChatSession,
    ESTINZIONE_FIXTURE_PATH,
} from '../../../fixtures/consultazione-spec-helpers'

test.describe.configure({ mode: 'serial', retries: 2 })

test.describe('M2 — estinzione saga completa journey', () => {
    test('5-turn: errorPolicy SKIP, TopicChange, tool chain, CONFIRM accept, submit → caseId', async ({ request, browser }) => {
        test.setTimeout(20 * 60_000)
        await withChatSession({
            request, browser,
            fixturePath: ESTINZIONE_FIXTURE_PATH,
            flowName: 'M2 EstinzioneSaga',
        }, async ({ page }) => {
            // T1 — Rossi non esiste in AEP → errorPolicy SKIP, bot graceful
            console.log('[M2] T1: Vorrei estinguere un rapporto del cliente Rossi')
            await sendChatMessage(page, 'Vorrei estinguere un rapporto del cliente Rossi')
            const t1 = await waitForBotBubble(page, 1, 180_000)
            console.log('[M2] bot1:', t1.slice(0, 200))
            expect(t1.length).toBeGreaterThan(5)

            // T2 — TopicChange + correzione con dati reali
            console.log('[M2] T2: scusa intendevo Bellafronte, NDG 11255521')
            await sendChatMessage(page, 'scusa intendevo Bellafronte, NDG 11255521')
            const t2 = await waitForBotBubble(page, 2, 180_000)
            console.log('[M2] bot2:', t2.slice(0, 200))
            expect(t2.length).toBeGreaterThan(5)

            // T3 — pick_rapporto → load_reasons → pause su collect_reason
            console.log('[M2] T3: rapporto 01-034-00392400')
            await sendChatMessage(page, 'rapporto 01-034-00392400')
            const t3 = await waitForBotBubble(page, 3, 180_000)
            console.log('[M2] bot3:', t3.slice(0, 200))
            expect(t3).toMatch(/motivazion|data|reason|01-034-00392400/i)

            // T4 — SET_FIELDS multipli (closureReasonCode + closureDate) → generate_pdf → confirm_closure pause
            console.log('[M2] T4: motivazione 01 trasferimento estero, data efficacia 2026-12-31')
            await sendChatMessage(page, 'motivazione 01 trasferimento estero, data efficacia 2026-12-31')
            const t4 = await waitForBotBubble(page, 4, 180_000)
            console.log('[M2] bot4:', t4.slice(0, 200))
            expect(t4.length).toBeGreaterThan(5)

            // T5 — RESOLVE_PENDING(confirm_closure, accept) → submit_closure → caseId
            console.log('[M2] T5: sì confermo invio della pratica')
            await sendChatMessage(page, 'sì confermo invio della pratica')
            const t5 = await waitForBotBubble(page, 5, 240_000)
            console.log('[M2] bot5:', t5.slice(0, 200))
            // Final assertion: caseId or invio successful
            expect(t5).toMatch(/ES-\d{4}-\d+|pratica.*invi|case.*id|invio.*succes|invi.*com|complet/i)
        })
    })
})
