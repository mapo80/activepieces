import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { turnInterpreterClient } from '../../src/lib/handler/turn-interpreter-client'

const fetchMock = vi.fn()
const baseConstants = {
    internalApiUrl: 'http://api.local/',
    engineToken: 'test-token',
} as never

beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
    vi.unstubAllGlobals()
})

describe('turnInterpreterClient.interpret', () => {
    it('returns body on 200', async () => {
        fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ turnStatus: 'prepared' }) })
        const res = await turnInterpreterClient.interpret({ constants: baseConstants, request: { turnId: 't1', idempotencyKey: 'i1' } as never })
        expect(res?.turnStatus).toBe('prepared')
        expect(fetchMock).toHaveBeenCalledWith(
            'http://api.local/v1/engine/interactive-flow-ai/command-layer/interpret-turn',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({ 'Authorization': 'Bearer test-token', 'Idempotency-Key': 'i1' }),
            }),
        )
    })
    it('returns body on 409 (replay/conflict)', async () => {
        fetchMock.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ turnStatus: 'failed', error: 'replay' }) })
        const res = await turnInterpreterClient.interpret({ constants: baseConstants, request: { turnId: 't2', idempotencyKey: 'i2' } as never })
        expect(res?.turnStatus).toBe('failed')
    })
    it('returns null on non-ok non-409 (e.g. 500)', async () => {
        fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
        expect(await turnInterpreterClient.interpret({ constants: baseConstants, request: { turnId: 't3', idempotencyKey: 'i3' } as never })).toBeNull()
    })
    it('returns null on json parse failure', async () => {
        fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => {
            throw new Error('bad-json') 
        } })
        expect(await turnInterpreterClient.interpret({ constants: baseConstants, request: { turnId: 't4', idempotencyKey: 'i4' } as never })).toBeNull()
    })
    it('returns null on fetch throw (network error)', async () => {
        fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))
        expect(await turnInterpreterClient.interpret({ constants: baseConstants, request: { turnId: 't5', idempotencyKey: 'i5' } as never })).toBeNull()
    })
})

describe('turnInterpreterClient.finalize', () => {
    it('returns true on 200 + ok=true', async () => {
        fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) })
        expect(await turnInterpreterClient.finalize({ constants: baseConstants, turnId: 't', leaseToken: 'lt' })).toBe(true)
    })
    it('returns false on 200 + ok=false', async () => {
        fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: false }) })
        expect(await turnInterpreterClient.finalize({ constants: baseConstants, turnId: 't', leaseToken: 'lt' })).toBe(false)
    })
    it('returns false on 404', async () => {
        fetchMock.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ ok: false }) })
        expect(await turnInterpreterClient.finalize({ constants: baseConstants, turnId: 't', leaseToken: 'lt' })).toBe(false)
    })
    it('returns false on json parse fail', async () => {
        fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => {
            throw new Error('x') 
        } })
        expect(await turnInterpreterClient.finalize({ constants: baseConstants, turnId: 't', leaseToken: 'lt' })).toBe(false)
    })
    it('returns false on fetch throw', async () => {
        fetchMock.mockRejectedValueOnce(new Error('boom'))
        expect(await turnInterpreterClient.finalize({ constants: baseConstants, turnId: 't', leaseToken: 'lt' })).toBe(false)
    })
})

describe('turnInterpreterClient.rollback', () => {
    it('forwards reason in body', async () => {
        fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) })
        await turnInterpreterClient.rollback({ constants: baseConstants, turnId: 't', leaseToken: 'lt', reason: 'engine-error' })
        const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
        expect(body).toEqual({ turnId: 't', leaseToken: 'lt', reason: 'engine-error' })
    })
    it('omits reason when undefined', async () => {
        fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) })
        await turnInterpreterClient.rollback({ constants: baseConstants, turnId: 't', leaseToken: 'lt' })
        const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
        expect(body.reason).toBeUndefined()
    })
    it('returns false on 4xx', async () => {
        fetchMock.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ ok: false }) })
        expect(await turnInterpreterClient.rollback({ constants: baseConstants, turnId: 't', leaseToken: 'lt' })).toBe(false)
    })
    it('returns false on fetch throw', async () => {
        fetchMock.mockRejectedValueOnce(new Error('x'))
        expect(await turnInterpreterClient.rollback({ constants: baseConstants, turnId: 't', leaseToken: 'lt' })).toBe(false)
    })
})

describe('turnInterpreterClient.buildCatalogReadiness', () => {
    it('returns ready=true when source array is non-empty', () => {
        expect(turnInterpreterClient.buildCatalogReadiness({
            state: { accounts: [{ id: 1 }] },
            stateFields: [{ name: 'ndg', type: 'string', enumFrom: 'accounts' } as never],
        })).toEqual({ accounts: true })
    })
    it('returns ready=false when source is empty array', () => {
        expect(turnInterpreterClient.buildCatalogReadiness({
            state: { accounts: [] },
            stateFields: [{ name: 'ndg', type: 'string', enumFrom: 'accounts' } as never],
        })).toEqual({ accounts: false })
    })
    it('returns ready=false when source is missing', () => {
        expect(turnInterpreterClient.buildCatalogReadiness({
            state: {},
            stateFields: [{ name: 'ndg', type: 'string', enumFrom: 'accounts' } as never],
        })).toEqual({ accounts: false })
    })
    it('returns empty object when no enumFrom present', () => {
        expect(turnInterpreterClient.buildCatalogReadiness({
            state: { accounts: [1] },
            stateFields: [{ name: 'plain', type: 'string' } as never],
        })).toEqual({})
    })
    it('deduplicates source names across stateFields', () => {
        expect(turnInterpreterClient.buildCatalogReadiness({
            state: { accounts: [1] },
            stateFields: [
                { name: 'a', type: 'string', enumFrom: 'accounts' } as never,
                { name: 'b', type: 'string', enumFrom: 'accounts' } as never,
            ],
        })).toEqual({ accounts: true })
    })
})
