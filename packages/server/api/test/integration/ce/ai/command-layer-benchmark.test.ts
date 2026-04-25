import { randomUUID } from 'node:crypto'
import { ConversationCommand, InterpretTurnRequest } from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MockProviderAdapter } from '../../../../src/app/ai/command-layer/provider-adapter'
import { turnInterpreter } from '../../../../src/app/ai/command-layer/turn-interpreter'
import { databaseConnection } from '../../../../src/app/database/database-connection'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance

beforeAll(async () => {
    app = await setupTestEnvironment()
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

type GoldenScenario = {
    id: string
    description: string
    userMessage: string
    pending: 'none' | 'pending_cancel' | 'pending_overwrite' | 'confirm_binary'
    providerCommands: ConversationCommand[]
    state?: Record<string, unknown>
    catalogReadiness?: Record<string, boolean>
    expectAcceptedTypes?: string[]
    expectRejectedReasonContains?: string[]
    expectMessageKind?: string
    expectPendingNext?: string | null
}

const SCENARIOS: GoldenScenario[] = [
    {
        id: 'g01-extract-customer-name',
        description: 'Simple extraction of customer name',
        userMessage: 'Bellafronte',
        pending: 'none',
        providerCommands: [{
            type: 'SET_FIELDS',
            updates: [{ field: 'customerName', value: 'Bellafronte', evidence: 'Bellafronte' }],
        }],
        expectAcceptedTypes: ['SET_FIELDS'],
        expectMessageKind: 'ack-only',
    },
    {
        id: 'g02-batched-extraction',
        description: 'Batched extraction of multiple fields',
        userMessage: 'Bellafronte rapporto 01-034-00392400',
        pending: 'none',
        providerCommands: [{
            type: 'SET_FIELDS',
            updates: [
                { field: 'customerName', value: 'Bellafronte', evidence: 'Bellafronte' },
                { field: 'rapportoId', value: '01-034-00392400', evidence: '01-034-00392400' },
            ],
        }],
        expectAcceptedTypes: ['SET_FIELDS'],
    },
    {
        id: 'g03-meta-question',
        description: 'Operator asks meta-question (what was asked)',
        userMessage: 'cosa mi avevi chiesto?',
        pending: 'none',
        providerCommands: [{
            type: 'ANSWER_META',
            kind: 'ask-repeat',
        }],
        expectAcceptedTypes: ['ANSWER_META'],
        expectMessageKind: 'meta-answer',
    },
    {
        id: 'g04-cancel-trigger',
        description: 'Operator types annulla → request_cancel auto-resolved',
        userMessage: 'annulla',
        pending: 'none',
        providerCommands: [],
        expectAcceptedTypes: ['REQUEST_CANCEL'],
        expectMessageKind: 'cancel-request',
        expectPendingNext: 'pending_cancel',
    },
    {
        id: 'g05-cancel-confirm',
        description: 'Operator confirms cancel during pending_cancel',
        userMessage: 'sì',
        pending: 'pending_cancel',
        providerCommands: [],
        expectAcceptedTypes: ['RESOLVE_PENDING'],
        expectMessageKind: 'cancel-confirmed',
        expectPendingNext: null,
    },
    {
        id: 'g06-cancel-reject',
        description: 'Operator rejects cancel during pending_cancel',
        userMessage: 'no',
        pending: 'pending_cancel',
        providerCommands: [],
        expectAcceptedTypes: ['RESOLVE_PENDING'],
        expectMessageKind: 'ack-only',
        expectPendingNext: null,
    },
    {
        id: 'g07-fabrication-rejected-p3',
        description: 'LLM fabricates value not in user message → P3 rejection',
        userMessage: 'qualcosa di altro',
        pending: 'none',
        providerCommands: [{
            type: 'SET_FIELDS',
            updates: [{ field: 'customerName', value: 'Hacker', evidence: 'Hacker' }],
        }],
        expectRejectedReasonContains: ['p3'],
    },
    {
        id: 'g08-empty-commands-reprompt',
        description: 'LLM returns no commands → reprompt',
        userMessage: 'asdf jkl',
        pending: 'none',
        providerCommands: [],
        expectMessageKind: 'reprompt',
    },
    {
        id: 'g09-info-question-with-state',
        description: 'Info-question answered with cited state field',
        userMessage: 'quanti rapporti ha',
        pending: 'none',
        state: { accounts: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
        providerCommands: [{
            type: 'ANSWER_INFO',
            infoIntent: 'count_accounts',
            citedFields: ['accounts'],
        }],
        expectAcceptedTypes: ['ANSWER_INFO'],
        expectMessageKind: 'info-answer',
    },
    {
        id: 'g10-compound-extract-and-info',
        description: 'Compound: SET_FIELDS + ANSWER_INFO',
        userMessage: 'Rossi quanti rapporti ha',
        pending: 'none',
        state: { accounts: [{ id: 'a' }] },
        providerCommands: [
            { type: 'SET_FIELDS', updates: [{ field: 'customerName', value: 'Rossi', evidence: 'Rossi' }] },
            { type: 'ANSWER_INFO', infoIntent: 'count_accounts', citedFields: ['accounts'] },
        ],
        expectAcceptedTypes: ['SET_FIELDS', 'ANSWER_INFO'],
        expectMessageKind: 'info-answer',
    },
    {
        id: 'g11-policy-rejected-unknown-field',
        description: 'LLM emits SET_FIELDS for unknown field → P1',
        userMessage: 'admin role test',
        pending: 'none',
        providerCommands: [{
            type: 'SET_FIELDS',
            updates: [{ field: 'admin_role', value: 'test', evidence: 'admin role test' }],
        }],
        expectRejectedReasonContains: ['p1'],
    },
    {
        id: 'g12-double-meta-cardinality-p9a',
        description: 'P9a syntactic cardinality: 2 ANSWER_META → first wins',
        userMessage: 'huh?',
        pending: 'none',
        providerCommands: [
            { type: 'ANSWER_META', kind: 'ask-repeat' },
            { type: 'ANSWER_META', kind: 'ask-clarify' },
        ],
        expectAcceptedTypes: ['ANSWER_META'],
        expectRejectedReasonContains: ['p9a'],
    },
    {
        id: 'g13-resolve-pending-without-pending-p6',
        description: 'RESOLVE_PENDING with no pending → P6',
        userMessage: 'qualcosa',
        pending: 'none',
        providerCommands: [{
            type: 'RESOLVE_PENDING',
            decision: 'accept',
            pendingType: 'confirm_binary',
        }],
        expectRejectedReasonContains: ['p6'],
    },
    {
        id: 'g14-info-cited-field-empty',
        description: 'ANSWER_INFO citing field that is empty in state → P5',
        userMessage: 'quanti rapporti ha',
        pending: 'none',
        state: {},
        providerCommands: [{
            type: 'ANSWER_INFO',
            infoIntent: 'count_accounts',
            citedFields: ['accounts'],
        }],
        expectRejectedReasonContains: ['p5'],
    },
    {
        id: 'g15-reprompt-emit-from-llm',
        description: 'LLM emits REPROMPT explicitly',
        userMessage: 'unclear',
        pending: 'none',
        providerCommands: [{ type: 'REPROMPT', reason: 'low-confidence' }],
        expectAcceptedTypes: ['REPROMPT'],
        expectMessageKind: 'reprompt',
    },
]

function buildRequest(scenario: GoldenScenario): InterpretTurnRequest {
    let pendingInteraction: InterpretTurnRequest['pendingInteraction'] = null
    if (scenario.pending === 'pending_cancel') {
        pendingInteraction = { type: 'pending_cancel', createdAt: new Date().toISOString() }
    }
    else if (scenario.pending === 'confirm_binary') {
        pendingInteraction = { type: 'confirm_binary', field: 'confirmed', target: true, nodeId: 'confirm_x' }
    }
    else if (scenario.pending === 'pending_overwrite') {
        pendingInteraction = { type: 'pending_overwrite', field: 'customerName', oldValue: 'X', newValue: 'Y', nodeId: 'pick_ndg' }
    }
    return {
        turnId: `turn-${randomUUID()}`,
        idempotencyKey: `idem-${randomUUID()}`,
        sessionId: `sess-${randomUUID()}`,
        sessionRevision: 0,
        flowRunId: 'run-bench',
        flowVersionId: 'v-bench',
        message: scenario.userMessage,
        state: scenario.state ?? {},
        history: [],
        pendingInteraction,
        stateFields: [
            { name: 'customerName', type: 'string', extractable: true, minLength: 2, maxLength: 50 },
            { name: 'accounts', type: 'array', extractable: false },
            { name: 'rapportoId', type: 'string', extractable: true, pattern: '^\\d{2}-\\d{3}-\\d{8}$' },
        ],
        nodes: [],
        currentNodeHint: null,
        infoIntents: [
            { id: 'count_accounts', description: 'count', requiredFields: ['accounts'], rendererKey: 'count_accounts' },
        ],
        catalogReadiness: scenario.catalogReadiness ?? {},
        locale: 'it',
    }
}

describe('command-layer golden benchmark scenarios', () => {
    it.each(SCENARIOS)('$id: $description', async (scenario) => {
        const provider = new MockProviderAdapter()
        provider.register({ matchUserMessage: () => true, commands: scenario.providerCommands })

        const req = buildRequest(scenario)
        const result = await turnInterpreter.interpret({ request: req, provider, identityFields: ['customerName'] })

        if (scenario.expectAcceptedTypes) {
            const acceptedTypes = result.acceptedCommands.map(c => c.type).sort()
            const expected = [...scenario.expectAcceptedTypes].sort()
            expect(acceptedTypes).toEqual(expect.arrayContaining(expected))
        }
        if (scenario.expectRejectedReasonContains) {
            const reasons = result.rejectedCommands.map(r => r.reason).join(' ')
            for (const expected of scenario.expectRejectedReasonContains) {
                expect(reasons).toContain(expected)
            }
        }
        if (scenario.expectMessageKind) {
            expect(result.messageOut.kind).toBe(scenario.expectMessageKind)
        }
        if (scenario.expectPendingNext === null) {
            expect(result.pendingInteractionNext).toBeNull()
        }
        else if (scenario.expectPendingNext) {
            expect(result.pendingInteractionNext?.type).toBe(scenario.expectPendingNext)
        }
    })
})
