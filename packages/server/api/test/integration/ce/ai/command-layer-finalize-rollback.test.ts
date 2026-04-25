import { randomUUID } from 'node:crypto'
import { InterpretTurnRequest } from '@activepieces/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MockProviderAdapter } from '../../../../src/app/ai/command-layer/provider-adapter'
import { turnInterpreter } from '../../../../src/app/ai/command-layer/turn-interpreter'
import { turnLogService } from '../../../../src/app/ai/command-layer/turn-log.service'
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

function buildRequest(overrides: Partial<InterpretTurnRequest> = {}): InterpretTurnRequest {
    return {
        turnId: `turn-${randomUUID()}`,
        idempotencyKey: `idem-${randomUUID()}`,
        sessionId: 'sess-fr',
        sessionRevision: 0,
        flowRunId: 'run-fr',
        flowVersionId: 'v-fr',
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

describe('command-layer finalize + rollback state machine', () => {
    it('A-11.1: finalize on missing turn → ok=false (404 at HTTP layer)', async () => {
        const outcome = await turnInterpreter.finalize({
            turnId: `turn-missing-${randomUUID()}`,
            leaseToken: randomUUID(),
        })
        expect(outcome.ok).toBe(false)
    })

    it('A-11.2: rollback on missing turn → ok=false', async () => {
        const outcome = await turnInterpreter.rollback({
            turnId: `turn-missing-${randomUUID()}`,
            leaseToken: randomUUID(),
            reason: 'engine-error',
        })
        expect(outcome.ok).toBe(false)
    })

    it('A-11.3: double finalize is idempotent (second call → ok=false, first leaves status=finalized)', async () => {
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

        const first = await turnInterpreter.finalize({
            turnId: result.finalizeContract.turnId,
            leaseToken: result.finalizeContract.leaseToken,
        })
        expect(first.ok).toBe(true)

        const second = await turnInterpreter.finalize({
            turnId: result.finalizeContract.turnId,
            leaseToken: result.finalizeContract.leaseToken,
        })
        expect(second.ok).toBe(false)

        const row = await turnLogService.findByTurnId({ turnId: result.finalizeContract.turnId })
        expect(row?.status).toBe('finalized')
    })

    it('A-11.4: rollback on already-finalized turn → ok=false', async () => {
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
        const finalize = await turnInterpreter.finalize({
            turnId: result.finalizeContract.turnId,
            leaseToken: result.finalizeContract.leaseToken,
        })
        expect(finalize.ok).toBe(true)

        const rollback = await turnInterpreter.rollback({
            turnId: result.finalizeContract.turnId,
            leaseToken: result.finalizeContract.leaseToken,
            reason: 'engine-error',
        })
        expect(rollback.ok).toBe(false)

        const row = await turnLogService.findByTurnId({ turnId: result.finalizeContract.turnId })
        expect(row?.status).toBe('finalized')
    })

    it('A-11.5: finalize with wrong leaseToken → ok=false, status remains prepared', async () => {
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

        const outcome = await turnInterpreter.finalize({
            turnId: result.finalizeContract.turnId,
            leaseToken: randomUUID(),
        })
        expect(outcome.ok).toBe(false)

        const row = await turnLogService.findByTurnId({ turnId: result.finalizeContract.turnId })
        expect(row?.status).toBe('prepared')
    })

    it('A-11.6: rollback with wrong leaseToken → ok=false, status remains prepared', async () => {
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

        const outcome = await turnInterpreter.rollback({
            turnId: result.finalizeContract.turnId,
            leaseToken: randomUUID(),
            reason: 'engine-error',
        })
        expect(outcome.ok).toBe(false)

        const row = await turnLogService.findByTurnId({ turnId: result.finalizeContract.turnId })
        expect(row?.status).toBe('prepared')
    })
})
