/**
 * Mid-conversation interruption tests.
 *
 * Verifies that the command layer handles messages that interrupt the
 * normal field-collection loop: meta-questions, info queries, topic
 * changes, compound multi-intent messages, and cancel flows.
 *
 * Run:
 *   cd packages/server/api && AP_EDITION=ce npx vitest run test/integration/ce/ai/command-layer-mid-conversation.test.ts
 */
import { randomUUID } from 'node:crypto'
import { InterpretTurnRequest } from '@activepieces/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MockProviderAdapter } from '../../../../src/app/ai/command-layer/provider-adapter'
import { turnInterpreter } from '../../../../src/app/ai/command-layer/turn-interpreter'
import { databaseConnection } from '../../../../src/app/database/database-connection'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

beforeAll(async () => {
    await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

beforeEach(async () => {
    const ds = databaseConnection()
    await ds.query('DELETE FROM "interactive_flow_outbox"')
    await ds.query('DELETE FROM "interactive_flow_session_sequence"')
    await ds.query('DELETE FROM "interactive_flow_turn_log"')
})

const CONSULTAZIONE_FIELDS = [
    { name: 'customerName', type: 'string', extractable: true, minLength: 2, maxLength: 50 },
    { name: 'customerMatches', type: 'array', extractable: false },
    { name: 'ndg', type: 'string', extractable: true, minLength: 6, maxLength: 12 },
    { name: 'accounts', type: 'array', extractable: false },
] as const

const CONSULTAZIONE_INTENTS = [
    { id: 'count_accounts', description: 'Numero di rapporti attivi del cliente', requiredFields: ['accounts'], rendererKey: 'count_accounts' },
    { id: 'count_matches', description: 'Numero di clienti corrispondenti alla ricerca', requiredFields: ['customerMatches'], rendererKey: 'count_matches' },
]

function buildReq(overrides: Partial<InterpretTurnRequest> = {}): InterpretTurnRequest {
    return {
        turnId: `turn-${randomUUID()}`,
        idempotencyKey: `idem-${randomUUID()}`,
        sessionId: `sess-${randomUUID()}`,
        sessionRevision: 0,
        flowRunId: `run-${randomUUID()}`,
        flowVersionId: 'v-consultazione-1',
        message: 'test',
        state: {},
        history: [],
        pendingInteraction: null,
        stateFields: [...CONSULTAZIONE_FIELDS] as never,
        nodes: [
            { nodeId: 'n1', nodeType: 'TOOL' as const, displayName: 'Cerca cliente', stateInputs: ['customerName'], stateOutputs: ['customerMatches'] },
            { nodeId: 'n2', nodeType: 'USER_INPUT' as const, displayName: 'Scegli cliente', stateInputs: ['customerMatches'], stateOutputs: ['ndg'] },
            { nodeId: 'n3', nodeType: 'TOOL' as const, displayName: 'Carica rapporti', stateInputs: ['ndg'], stateOutputs: ['accounts'] },
        ],
        currentNodeHint: null,
        infoIntents: CONSULTAZIONE_INTENTS,
        systemPrompt: undefined,
        locale: 'it',
        catalogReadiness: {},
        ...overrides,
    }
}

describe('mid-conversation interruptions', () => {
    it('MID-01: meta-question "cosa mi avevi chiesto?" → meta-answer, state unchanged', async () => {
        const provider = new MockProviderAdapter()
        // Turn 1: extract customerName
        provider.register({
            matchUserMessage: (m) => m.includes('Bellafronte'),
            commands: [{
                type: 'SET_FIELDS',
                updates: [{ field: 'customerName', value: 'Bellafronte', evidence: 'Bellafronte' }],
            }],
        })
        const t1 = buildReq({ message: 'Bellafronte' })
        const r1 = await turnInterpreter.interpret({ request: t1, provider, identityFields: ['customerName'] })
        expect(r1.stateDiff.customerName).toBe('Bellafronte')

        // Turn 2: meta-question mid-flow
        provider.register({
            matchUserMessage: (m) => m.includes('cosa mi avevi chiesto'),
            commands: [{
                type: 'ANSWER_META',
                kind: 'ask-repeat',
                message: 'Ti stavo chiedendo di scegliere il cliente dalla lista.',
            }],
        })
        const t2 = buildReq({
            message: 'cosa mi avevi chiesto?',
            state: { customerName: 'Bellafronte' },
        })
        const r2 = await turnInterpreter.interpret({ request: t2, provider, identityFields: ['customerName'] })

        expect(r2.messageOut.kind).toBe('meta-answer')
        expect(Object.keys(r2.stateDiff)).toHaveLength(0) // state did NOT advance
        expect(r2.turnStatus).toBe('prepared')
    })

    it('MID-02: info query "quanti rapporti ha?" → info-answer, state unchanged', async () => {
        const provider = new MockProviderAdapter()
        provider.register({
            matchUserMessage: (m) => m.includes('quanti rapporti'),
            commands: [{
                type: 'ANSWER_INFO',
                infoIntent: 'count_accounts',
                citedFields: ['accounts'],
            }],
        })
        const req = buildReq({
            message: 'quanti rapporti ha?',
            state: {
                customerName: 'Bellafronte',
                ndg: '11255521',
                accounts: [{ id: 'acc-01' }, { id: 'acc-02' }, { id: 'acc-03' }],
            },
        })
        const result = await turnInterpreter.interpret({ request: req, provider, identityFields: ['customerName'] })

        expect(result.messageOut.kind).toBe('info-answer')
        expect(Object.keys(result.stateDiff)).toHaveLength(0) // state did NOT advance
        expect(result.turnStatus).toBe('prepared')
    })

    it('MID-03: topic change "scusa il cliente è Rossi" → new customerName in stateDiff', async () => {
        const provider = new MockProviderAdapter()
        // Turn 1: Bellafronte
        provider.register({
            matchUserMessage: (m) => m.includes('Bellafronte'),
            commands: [{
                type: 'SET_FIELDS',
                updates: [{ field: 'customerName', value: 'Bellafronte', evidence: 'Bellafronte' }],
            }],
        })
        const t1 = buildReq({ message: 'Bellafronte' })
        const r1 = await turnInterpreter.interpret({ request: t1, provider, identityFields: ['customerName'] })
        expect(r1.stateDiff.customerName).toBe('Bellafronte')

        // Turn 2: topic change to Rossi — new customerName overwrites
        provider.register({
            matchUserMessage: (m) => m.includes('Rossi'),
            commands: [{
                type: 'SET_FIELDS',
                updates: [{ field: 'customerName', value: 'Rossi', evidence: 'scusa il cliente è Rossi' }],
            }],
        })
        const t2 = buildReq({
            message: 'scusa il cliente è Rossi',
            state: { customerName: 'Bellafronte', customerMatches: [{ id: 'bel-01' }] },
        })
        const r2 = await turnInterpreter.interpret({ request: t2, provider, identityFields: ['customerName'] })

        expect(r2.stateDiff.customerName).toBe('Rossi')
        expect(r2.turnStatus).toBe('prepared')
        // The engine session-store will detect the topic change (customerName changed)
        // and clear downstream fields (customerMatches, ndg, accounts).
        // That logic lives in session-store.applyStateOverwriteWithTopicChange
        // and is verified separately in session-store.test.ts.
    })

    it('MID-04: compound message "Rossi quanti rapporti ha?" → SET_FIELDS + ANSWER_INFO same turn', async () => {
        const provider = new MockProviderAdapter()
        provider.register({
            matchUserMessage: (m) => m.includes('Rossi') && m.includes('quanti'),
            commands: [
                {
                    type: 'SET_FIELDS',
                    updates: [{ field: 'customerName', value: 'Rossi', evidence: 'Rossi' }],
                },
                {
                    type: 'ANSWER_INFO',
                    infoIntent: 'count_accounts',
                    citedFields: ['accounts'],
                },
            ],
        })
        const req = buildReq({
            message: 'Rossi quanti rapporti ha?',
            state: { accounts: [{ id: 'acc-A' }, { id: 'acc-B' }] },
        })
        const result = await turnInterpreter.interpret({ request: req, provider, identityFields: ['customerName'] })

        expect(result.stateDiff.customerName).toBe('Rossi')
        // ANSWER_INFO is the primary message kind when both SET_FIELDS + ANSWER_INFO accepted
        expect(['info-answer', 'ack-only']).toContain(result.messageOut.kind)
        expect(result.acceptedCommands.length).toBe(2)
        expect(result.turnStatus).toBe('prepared')
    })

    it('MID-05: cancel "annulla" → pending_cancel; then "no" → cancel-rejected, state preserved', async () => {
        const provider = new MockProviderAdapter()
        const sessionId = `sess-${randomUUID()}`

        // Turn 1: trigger cancel
        const t1 = buildReq({
            sessionId,
            message: 'annulla per favore',
            state: { customerName: 'Bellafronte', ndg: '11255521' },
        })
        const r1 = await turnInterpreter.interpret({ request: t1, provider, identityFields: ['customerName'] })

        expect(r1.pendingInteractionNext?.type).toBe('pending_cancel')
        expect(r1.messageOut.kind).toBe('cancel-request')
        expect(r1.turnStatus).toBe('prepared')

        // Turn 2: reject cancel — "no"
        const t2 = buildReq({
            sessionId,
            message: 'no grazie continuiamo',
            state: { customerName: 'Bellafronte', ndg: '11255521' },
            pendingInteraction: r1.pendingInteractionNext as never,
        })
        const r2 = await turnInterpreter.interpret({ request: t2, provider, identityFields: ['customerName'] })

        expect(r2.pendingInteractionNext).toBeNull()
        // RESOLVE_PENDING reject → messageOut.kind = 'ack-only' (buildMessageOut only
        // distinguishes accept=cancel-confirmed; reject falls through to ack-only)
        expect(r2.messageOut.kind).toBe('ack-only')
        // The turn-event KIND is CANCEL_REJECTED (emitted to outbox)
        const cancelRejected = r2.turnEvents?.find(e => e.kind === 'CANCEL_REJECTED')
        expect(cancelRejected).toBeDefined()
        // Original state fields preserved — stateDiff is empty
        expect(r2.stateDiff.customerName).toBeUndefined()
        expect(r2.turnStatus).toBe('prepared')
    })
})
