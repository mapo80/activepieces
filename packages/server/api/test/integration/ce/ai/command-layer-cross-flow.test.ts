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

function buildRequest(overrides: Partial<InterpretTurnRequest>): InterpretTurnRequest {
    return {
        turnId: `turn-${randomUUID()}`,
        idempotencyKey: `idem-${randomUUID()}`,
        sessionId: `sess-${randomUUID()}`,
        sessionRevision: 0,
        flowRunId: `run-${randomUUID()}`,
        flowVersionId: 'v-1',
        message: '',
        state: {},
        history: [],
        pendingInteraction: null,
        stateFields: [],
        nodes: [],
        currentNodeHint: null,
        infoIntents: [],
        systemPrompt: undefined,
        locale: 'it',
        catalogReadiness: {},
        ...overrides,
    }
}

describe('cross-flow command layer', () => {
    it('A-12.1: consultazione fixture extracts customerName + ndg', async () => {
        const provider = new MockProviderAdapter()
        provider.register({
            matchUserMessage: () => true,
            commands: [{
                type: 'SET_FIELDS',
                updates: [
                    { field: 'customerName', value: 'Bellafronte', evidence: 'Bellafronte' },
                    { field: 'ndg', value: '12345678', evidence: '12345678' },
                ],
            }],
        })
        const req = buildRequest({
            message: 'Bellafronte, NDG 12345678',
            stateFields: [
                { name: 'customerName', type: 'string', extractable: true } as never,
                { name: 'ndg', type: 'string', extractable: true } as never,
            ],
        })
        const result = await turnInterpreter.interpret({
            request: req,
            provider,
            identityFields: ['customerName'],
        })
        expect(result.stateDiff.customerName).toBe('Bellafronte')
        expect(result.stateDiff.ndg).toBe('12345678')
    })

    it('A-12.2: estinzione fixture extracts closureReasonCode (distinct surface)', async () => {
        const provider = new MockProviderAdapter()
        provider.register({
            matchUserMessage: () => true,
            commands: [{
                type: 'SET_FIELDS',
                updates: [{ field: 'closureReasonCode', value: '01', evidence: 'motivazione 01' }],
            }],
        })
        const req = buildRequest({
            message: 'motivazione 01',
            stateFields: [
                { name: 'closureReasonCode', type: 'string', extractable: true } as never,
            ],
        })
        const result = await turnInterpreter.interpret({
            request: req,
            provider,
            identityFields: [],
        })
        expect(result.stateDiff.closureReasonCode).toBe('01')
        expect(result.stateDiff.customerName).toBeUndefined()
    })

    it('A-12.3: empty provider commands → empty stateDiff (legacy fixture proxy)', async () => {
        const provider = new MockProviderAdapter()
        provider.register({ matchUserMessage: () => true, commands: [] })
        const req = buildRequest({
            message: 'Hello',
            stateFields: [{ name: 'customerName', type: 'string', extractable: true } as never],
        })
        const result = await turnInterpreter.interpret({
            request: req,
            provider,
            identityFields: ['customerName'],
        })
        expect(result.stateDiff).toEqual({})
        expect(result.acceptedCommands).toEqual([])
    })

    it('A-12.4: commands across distinct flows do not bleed state across sessions', async () => {
        const consultProvider = new MockProviderAdapter()
        consultProvider.register({
            matchUserMessage: () => true,
            commands: [{
                type: 'SET_FIELDS',
                updates: [{ field: 'customerName', value: 'Rossi', evidence: 'Rossi' }],
            }],
        })

        const estinzProvider = new MockProviderAdapter()
        estinzProvider.register({
            matchUserMessage: () => true,
            commands: [{
                type: 'SET_FIELDS',
                updates: [{ field: 'closureReasonCode', value: '02', evidence: 'codice 02' }],
            }],
        })

        const consultReq = buildRequest({
            message: 'Rossi',
            stateFields: [{ name: 'customerName', type: 'string', extractable: true } as never],
        })
        const estinzReq = buildRequest({
            message: 'codice 02',
            stateFields: [{ name: 'closureReasonCode', type: 'string', extractable: true } as never],
        })

        const [a, b] = await Promise.all([
            turnInterpreter.interpret({ request: consultReq, provider: consultProvider, identityFields: ['customerName'] }),
            turnInterpreter.interpret({ request: estinzReq, provider: estinzProvider, identityFields: [] }),
        ])
        expect(a.stateDiff.customerName).toBe('Rossi')
        expect(a.stateDiff.closureReasonCode).toBeUndefined()
        expect(b.stateDiff.closureReasonCode).toBe('02')
        expect(b.stateDiff.customerName).toBeUndefined()
    })
})
