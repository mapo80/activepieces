import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { commandLayerClientAdapter, interpretTurn } from '../../src/lib/handler/turn-interpreter-adapter'
import { generateMockEngineConstants } from './test-helper'

const fetchMock = vi.fn()

beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
    vi.unstubAllGlobals()
})

const baseArgs = {
    constants: generateMockEngineConstants(),
    message: 'hello',
    state: {},
    history: [],
    stateFields: [],
    nodes: [],
    currentNode: null,
    pendingInteraction: null,
    identityFields: [],
    infoIntents: [],
    sessionId: 'sess-1',
    sessionRevision: 0,
    flowVersionId: 'v-1',
}

describe('commandLayerClientAdapter.interpret', () => {
    const validResponse = {
        turnStatus: 'prepared',
        messageOut: { preDagAck: 'ok', kind: 'ack-only' },
        stateDiff: { customerName: 'Polito' },
        pendingInteractionNext: null,
        topicChange: { topicChanged: false, clearedKeys: [] },
        pendingOverwriteSignal: null,
        rejectionHint: null,
        lastPolicyDecisions: [],
        turnEvents: [],
        acceptedCommands: [{ type: 'SET_FIELDS', updates: [{ field: 'customerName', value: 'Polito', evidence: 'Polito' }] }],
        rejectedCommands: [],
        finalizeContract: { turnId: 't', leaseToken: '00000000-0000-4000-8000-000000000000' },
    }

    it('returns mapped TurnResult on successful response', async () => {
        fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => validResponse })
        const result = await commandLayerClientAdapter.interpret(baseArgs as never)
        expect(result.extractedFields).toEqual({ customerName: 'Polito' })
        expect(result.turnAffirmed).toBe(true)
        expect(result.messageOut?.preDagAck).toBe('ok')
        expect(result.finalizeContract?.leaseToken).toBe('00000000-0000-4000-8000-000000000000')
    })

    it('returns emptyTurnResult on null response (network/parse failure)', async () => {
        fetchMock.mockRejectedValueOnce(new Error('boom'))
        const result = await commandLayerClientAdapter.interpret(baseArgs as never)
        expect(result.extractedFields).toEqual({})
        expect(result.turnAffirmed).toBe(false)
    })

    it('attaches USER_INPUT currentNode hint to request', async () => {
        fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => validResponse })
        await commandLayerClientAdapter.interpret({
            ...baseArgs,
            currentNode: { nodeId: 'n1', nodeType: 'USER_INPUT', displayName: 'Nome', stateOutputs: ['customerName'] },
        } as never)
        const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
        expect(body.currentNodeHint).toEqual(expect.objectContaining({ nodeId: 'n1', nodeType: 'USER_INPUT' }))
    })

    it('attaches CONFIRM currentNode hint to request', async () => {
        fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => validResponse })
        await commandLayerClientAdapter.interpret({
            ...baseArgs,
            currentNode: { nodeId: 'c1', nodeType: 'CONFIRM' },
        } as never)
        const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
        expect(body.currentNodeHint?.nodeType).toBe('CONFIRM')
    })

    it('passes null currentNodeHint for non-USER_INPUT/non-CONFIRM nodes', async () => {
        fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => validResponse })
        await commandLayerClientAdapter.interpret({
            ...baseArgs,
            currentNode: { nodeId: 'tool1', nodeType: 'TOOL' },
        } as never)
        const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
        expect(body.currentNodeHint).toBeNull()
    })

    it('builds catalogReadiness from stateFields enumFrom', async () => {
        fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => validResponse })
        await commandLayerClientAdapter.interpret({
            ...baseArgs,
            state: { accounts: [{ id: 1 }] },
            stateFields: [{ name: 'ndg', type: 'string', enumFrom: 'accounts' }],
        } as never)
        const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
        expect(body.catalogReadiness).toEqual({ accounts: true })
    })
})

describe('interpretTurn', () => {
    it('calls commandLayerClientAdapter', async () => {
        const validResponse = {
            turnStatus: 'prepared',
            messageOut: { preDagAck: 'ok', kind: 'ack-only' },
            stateDiff: {},
            pendingInteractionNext: null,
            topicChange: { topicChanged: false, clearedKeys: [] },
            pendingOverwriteSignal: null,
            rejectionHint: null,
            lastPolicyDecisions: [],
            turnEvents: [],
            acceptedCommands: [],
            rejectedCommands: [],
            finalizeContract: { turnId: 't', leaseToken: '00000000-0000-4000-8000-000000000000' },
        }
        fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => validResponse })
        const result = await interpretTurn({ ...baseArgs, useCommandLayer: true } as never)
        expect(result.extractedFields).toEqual({})
        expect(fetchMock).toHaveBeenCalled()
    })
})
