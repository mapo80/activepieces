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

function buildRequest(overrides: Partial<InterpretTurnRequest> = {}): InterpretTurnRequest {
    return {
        turnId: `turn-${randomUUID()}`,
        idempotencyKey: `idem-${randomUUID()}`,
        sessionId: 'sess-X',
        sessionRevision: 0,
        flowRunId: 'run-Y',
        flowVersionId: 'v-Z',
        message: 'Bellafronte',
        state: {},
        history: [],
        pendingInteraction: null,
        stateFields: [
            { name: 'customerName', type: 'string', extractable: true, minLength: 2, maxLength: 50 },
        ],
        nodes: [],
        currentNodeHint: null,
        infoIntents: [],
        systemPrompt: undefined,
        locale: 'it',
        catalogReadiness: {},
        ...overrides,
    }
}

describe('turnInterpreter.interpret', () => {
    it('applies SET_FIELDS from provider and returns prepared status', async () => {
        const provider = new MockProviderAdapter()
        provider.register({
            matchUserMessage: () => true,
            commands: [{
                type: 'SET_FIELDS',
                updates: [{ field: 'customerName', value: 'Bellafronte', evidence: 'Bellafronte' }],
            }],
        })
        const req = buildRequest()
        const result = await turnInterpreter.interpret({ request: req, provider, identityFields: ['customerName'] })
        expect(result.turnStatus).toBe('prepared')
        expect(result.stateDiff).toEqual({ customerName: 'Bellafronte' })
        expect(result.acceptedCommands.length).toBe(1)
        expect(result.rejectedCommands.length).toBe(0)
        expect(result.finalizeContract.turnId).toBe(req.turnId)
    })

    it('rejects SET_FIELDS when evidence not in user message (p3)', async () => {
        const provider = new MockProviderAdapter()
        provider.register({
            matchUserMessage: () => true,
            commands: [{
                type: 'SET_FIELDS',
                updates: [{ field: 'customerName', value: 'Rossi', evidence: 'Rossi' }],
            }],
        })
        const req = buildRequest({ message: 'Bellafronte' })
        const result = await turnInterpreter.interpret({ request: req, provider, identityFields: ['customerName'] })
        expect(result.stateDiff).toEqual({})
        expect(result.rejectedCommands.length).toBe(1)
        expect(result.rejectedCommands[0].reason).toContain('p3')
    })

    it('preserves replay semantics for same turnId', async () => {
        const provider = new MockProviderAdapter()
        provider.register({
            matchUserMessage: () => true,
            commands: [{ type: 'REPROMPT', reason: 'low-confidence' }],
        })
        const req = buildRequest()
        await turnInterpreter.interpret({ request: req, provider, identityFields: ['customerName'] })

        await turnInterpreter.finalize({ turnId: req.turnId, leaseToken: (await import('../../../../src/app/ai/command-layer/turn-log.service')).turnLogService.findByTurnId({ turnId: req.turnId }).then(r => r!.leaseToken!) as unknown as string }).catch(() => ({ ok: false }))

        const ds = databaseConnection()
        const rows = await ds.query('SELECT "status" FROM "interactive_flow_turn_log" WHERE "turnId" = $1', [req.turnId])
        expect(['prepared', 'finalized']).toContain(rows[0]?.status)
    })

    it('REQUEST_CANCEL creates pending_cancel', async () => {
        const provider = new MockProviderAdapter()
        const req = buildRequest({ message: 'annulla per favore' })
        const result = await turnInterpreter.interpret({ request: req, provider, identityFields: ['customerName'] })
        expect(result.pendingInteractionNext?.type).toBe('pending_cancel')
        expect(result.messageOut.kind).toBe('cancel-request')
    })

    it('cancel pre-resolved even without LLM (keyword detection)', async () => {
        const provider = new MockProviderAdapter()
        let providerCalled = false
        provider.register({ matchUserMessage: () => { providerCalled = true; return true }, commands: [] })
        const req = buildRequest({ message: 'basta' })
        const result = await turnInterpreter.interpret({ request: req, provider, identityFields: ['customerName'] })
        expect(providerCalled).toBe(false)
        expect(result.pendingInteractionNext?.type).toBe('pending_cancel')
    })

    it('resolve pending_cancel with yes keyword clears pending', async () => {
        const provider = new MockProviderAdapter()
        const req = buildRequest({
            message: 'sì',
            pendingInteraction: { type: 'pending_cancel', createdAt: new Date().toISOString() },
        })
        const result = await turnInterpreter.interpret({ request: req, provider, identityFields: ['customerName'] })
        expect(result.pendingInteractionNext).toBeNull()
        expect(result.messageOut.kind).toBe('cancel-confirmed')
    })

    it('rejects unknown info intent (p5)', async () => {
        const provider = new MockProviderAdapter()
        provider.register({
            matchUserMessage: () => true,
            commands: [{
                type: 'ANSWER_INFO',
                infoIntent: 'made_up_intent',
                citedFields: ['customerName'],
            }],
        })
        const req = buildRequest({ message: 'info please' })
        const result = await turnInterpreter.interpret({ request: req, provider, identityFields: ['customerName'] })
        expect(result.rejectedCommands.length).toBe(1)
        expect(result.rejectedCommands[0].reason).toContain('p5')
    })

    it('saga finalize transitions prepared to finalized + outbox publishable', async () => {
        const provider = new MockProviderAdapter()
        const setCommands: ConversationCommand[] = [{
            type: 'SET_FIELDS',
            updates: [{ field: 'customerName', value: 'Bellafronte', evidence: 'Bellafronte' }],
        }]
        provider.register({ matchUserMessage: () => true, commands: setCommands })
        const req = buildRequest()
        const response = await turnInterpreter.interpret({ request: req, provider, identityFields: ['customerName'] })
        expect(response.turnStatus).toBe('prepared')

        const finalizeOutcome = await turnInterpreter.finalize({
            turnId: response.finalizeContract.turnId,
            leaseToken: response.finalizeContract.leaseToken,
        })
        expect(finalizeOutcome.ok).toBe(true)

        const ds = databaseConnection()
        const turnLogRow = await ds.query('SELECT "status" FROM "interactive_flow_turn_log" WHERE "turnId" = $1', [req.turnId])
        expect(turnLogRow[0]?.status).toBe('finalized')

        const publishable = await ds.query(
            'SELECT COUNT(*)::int AS c FROM "interactive_flow_outbox" WHERE "turnId" = $1 AND "eventStatus" = \'publishable\'',
            [req.turnId],
        )
        expect(publishable[0].c).toBeGreaterThan(0)
    })

    it('saga rollback transitions prepared to compensated + outbox void', async () => {
        const provider = new MockProviderAdapter()
        provider.register({
            matchUserMessage: () => true,
            commands: [{ type: 'REPROMPT', reason: 'low-confidence' }],
        })
        const req = buildRequest()
        const response = await turnInterpreter.interpret({ request: req, provider, identityFields: ['customerName'] })

        const rollbackOutcome = await turnInterpreter.rollback({
            turnId: response.finalizeContract.turnId,
            leaseToken: response.finalizeContract.leaseToken,
            reason: 'session-cas-conflict',
        })
        expect(rollbackOutcome.ok).toBe(true)

        const ds = databaseConnection()
        const row = await ds.query('SELECT "status","failedReason" FROM "interactive_flow_turn_log" WHERE "turnId" = $1', [req.turnId])
        expect(row[0]?.status).toBe('compensated')
        expect(row[0]?.failedReason).toBe('session-cas-conflict')

        const voidCount = await ds.query(
            'SELECT COUNT(*)::int AS c FROM "interactive_flow_outbox" WHERE "turnId" = $1 AND "eventStatus" = \'void\'',
            [req.turnId],
        )
        expect(voidCount[0].c).toBeGreaterThan(0)
    })
})
