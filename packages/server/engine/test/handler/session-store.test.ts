import { InteractiveFlowStateField } from '@activepieces/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_HISTORY_MAX_TURNS, SessionRecord, sessionStore } from '../../src/lib/handler/session-store'
import { generateMockEngineConstants } from './test-helper'

type FetchCall = { url: string, init: RequestInit | undefined }

function installFetchMock(): {
    spy: ReturnType<typeof vi.fn>
    calls: FetchCall[]
    respondGet: (body: unknown, status?: number) => void
    respondNotFound: () => void
    respondPut: () => void
    respondDelete: () => void
    queue: Array<() => Response>
} {
    const calls: FetchCall[] = []
    const queue: Array<() => Response> = []
    const spy = vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : String((input as { url?: string }).url ?? input)
        calls.push({ url, init })
        const next = queue.shift()
        if (!next) {
            return {
                ok: true,
                status: 200,
                json: async () => ({}),
                text: async () => '',
            } as unknown as Response
        }
        return next()
    })
    globalThis.fetch = spy as unknown as typeof fetch
    return {
        spy,
        calls,
        queue,
        respondGet: (body, status = 200) => {
            queue.push(() => ({
                ok: status >= 200 && status < 300,
                status,
                json: async () => body,
                text: async () => JSON.stringify(body),
            } as unknown as Response))
        },
        respondNotFound: () => {
            queue.push(() => ({
                ok: false,
                status: 404,
                json: async () => null,
                text: async () => '',
            } as unknown as Response))
        },
        respondPut: () => {
            queue.push(() => ({
                ok: true,
                status: 200,
                json: async () => ({}),
                text: async () => '',
            } as unknown as Response))
        },
        respondDelete: () => {
            queue.push(() => ({
                ok: true,
                status: 204,
                json: async () => null,
                text: async () => '',
            } as unknown as Response))
        },
    }
}

const FIELDS: InteractiveFlowStateField[] = [
    { name: 'customerName', type: 'string', extractable: true },
    { name: 'ndg', type: 'string', extractable: true },
    { name: 'customerMatches', type: 'array', extractable: false },
    { name: 'caseId', type: 'string', extractable: false },
]

describe('sessionStore.makeSessionKey', () => {
    it('uses action name as default namespace (isolation between IF actions)', () => {
        const keyA = sessionStore.makeSessionKey({ actionName: 'estinzione', sessionNamespace: undefined, sessionId: 'abc123' })
        const keyB = sessionStore.makeSessionKey({ actionName: 'approvazione', sessionNamespace: undefined, sessionId: 'abc123' })
        expect(keyA).toBe('ifsession:estinzione:abc123')
        expect(keyB).toBe('ifsession:approvazione:abc123')
        expect(keyA).not.toBe(keyB)
    })

    it('namespace overrides actionName (bucket sharing across IFs in a pipeline)', () => {
        const keyA = sessionStore.makeSessionKey({ actionName: 'estinzione', sessionNamespace: 'banking-conv', sessionId: 'abc123' })
        const keyB = sessionStore.makeSessionKey({ actionName: 'approvazione', sessionNamespace: 'banking-conv', sessionId: 'abc123' })
        expect(keyA).toBe('ifsession:banking-conv:abc123')
        expect(keyA).toBe(keyB)
    })

    it('lowercases and trims namespace deterministically', () => {
        const key = sessionStore.makeSessionKey({ actionName: '  Estinzione  ', sessionNamespace: undefined, sessionId: 'abc123' })
        expect(key).toBe('ifsession:estinzione:abc123')
    })
})

describe('sessionStore.load', () => {
    let fetchMock: ReturnType<typeof installFetchMock>
    beforeEach(() => {
        fetchMock = installFetchMock() 
    })
    afterEach(() => {
        vi.restoreAllMocks() 
    })

    it('returns {record:null} when store responds 404 (first turn)', async () => {
        fetchMock.respondNotFound()
        const result = await sessionStore.load({
            key: 'ifsession:estinzione:abc',
            constants: generateMockEngineConstants(),
            currentFlowVersionId: 'v1',
        })
        expect(result.record).toBeNull()
        expect(result.versionMismatch).toBe(false)
    })

    it('returns versionMismatch=true when flowVersionId differs', async () => {
        const stale: SessionRecord = {
            state: { customerName: 'Polito' },
            history: [{ role: 'user', text: 'ciao' }],
            flowVersionId: 'v-OLD',
            lastTurnAt: '2026-01-01T00:00:00Z',
        }
        fetchMock.respondGet({ value: stale })
        const result = await sessionStore.load({
            key: 'ifsession:estinzione:abc',
            constants: generateMockEngineConstants(),
            currentFlowVersionId: 'v-NEW',
        })
        expect(result.versionMismatch).toBe(true)
        expect(result.record?.flowVersionId).toBe('v-OLD')
    })

    it('returns full record when flowVersionId matches', async () => {
        const current: SessionRecord = {
            state: { customerName: 'Polito', ndg: '42' },
            history: [{ role: 'user', text: 'ciao' }, { role: 'assistant', text: 'ndg?' }],
            flowVersionId: 'v-MATCH',
            lastTurnAt: '2026-04-20T10:00:00Z',
        }
        fetchMock.respondGet({ value: current })
        const result = await sessionStore.load({
            key: 'ifsession:estinzione:abc',
            constants: generateMockEngineConstants(),
            currentFlowVersionId: 'v-MATCH',
        })
        expect(result.versionMismatch).toBe(false)
        expect(result.record).toEqual(current)
    })
})

describe('sessionStore.save', () => {
    let fetchMock: ReturnType<typeof installFetchMock>
    beforeEach(() => {
        fetchMock = installFetchMock() 
    })
    afterEach(() => {
        vi.restoreAllMocks() 
    })

    it('posts full record with lastTurnAt ISO timestamp', async () => {
        fetchMock.respondPut()
        const result = await sessionStore.save({
            key: 'ifsession:estinzione:abc',
            constants: generateMockEngineConstants(),
            state: { customerName: 'Polito' },
            history: [{ role: 'user', text: 'ciao' }],
            flowVersionId: 'v1',
            historyMaxTurns: 20,
        })
        expect(result.bytes).toBeGreaterThan(0)
        expect(result.truncated).toBe(false)
        const putCall = fetchMock.calls[0]
        expect(putCall.init?.method).toBe('POST')
        const body = JSON.parse(String(putCall.init?.body))
        expect(body.value.state).toEqual({ customerName: 'Polito' })
        expect(body.value.history).toEqual([{ role: 'user', text: 'ciao' }])
        expect(body.value.flowVersionId).toBe('v1')
        expect(body.value.lastTurnAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    it('caps history at historyMaxTurns (sliding window)', async () => {
        fetchMock.respondPut()
        const longHistory = Array.from({ length: 30 }, (_, i) => ({
            role: 'user' as const,
            text: `msg-${i}`,
        }))
        await sessionStore.save({
            key: 'ifsession:estinzione:abc',
            constants: generateMockEngineConstants(),
            state: {},
            history: longHistory,
            flowVersionId: 'v1',
            historyMaxTurns: 5,
        })
        const body = JSON.parse(String(fetchMock.calls[0].init?.body))
        expect(body.value.history).toHaveLength(5)
        expect(body.value.history[0].text).toBe('msg-25')
        expect(body.value.history[4].text).toBe('msg-29')
    })

    it('flags truncated=true when payload exceeds the 400KB soft limit', async () => {
        fetchMock.respondPut()
        const hugeText = 'x'.repeat(80 * 1024)
        const heavyHistory = Array.from({ length: 10 }, (_, i) => ({
            role: 'assistant' as const,
            text: `${hugeText}-${i}`,
        }))
        const result = await sessionStore.save({
            key: 'ifsession:estinzione:abc',
            constants: generateMockEngineConstants(),
            state: {},
            history: heavyHistory,
            flowVersionId: 'v1',
            historyMaxTurns: 20,
        })
        expect(result.truncated).toBe(true)
        const body = JSON.parse(String(fetchMock.calls[0].init?.body))
        expect(body.value.history.length).toBeLessThanOrEqual(5)
    })

    it('DEFAULT_HISTORY_MAX_TURNS constant is 20', () => {
        expect(DEFAULT_HISTORY_MAX_TURNS).toBe(20)
    })
})

describe('sessionStore.clear', () => {
    let fetchMock: ReturnType<typeof installFetchMock>
    beforeEach(() => {
        fetchMock = installFetchMock() 
    })
    afterEach(() => {
        vi.restoreAllMocks() 
    })

    it('issues DELETE on the store-entries endpoint', async () => {
        fetchMock.respondDelete()
        await sessionStore.clear({
            key: 'ifsession:estinzione:abc',
            constants: generateMockEngineConstants(),
        })
        expect(fetchMock.calls[0].init?.method).toBe('DELETE')
        expect(fetchMock.calls[0].url).toContain('v1/store-entries')
    })
})

describe('sessionStore.detectTopicChange', () => {
    it('returns true when an existing extractable field is overwritten with a new value', () => {
        const changed = sessionStore.detectTopicChange({
            previousState: { customerName: 'Bellafronte' },
            incoming: { customerName: 'Rossi' },
            fields: FIELDS,
        })
        expect(changed).toBe(true)
    })

    it('returns false when incoming matches previous (idempotent re-extraction)', () => {
        const changed = sessionStore.detectTopicChange({
            previousState: { customerName: 'Bellafronte' },
            incoming: { customerName: 'Bellafronte' },
            fields: FIELDS,
        })
        expect(changed).toBe(false)
    })

    it('returns false when previous state is nil for that field (first fill)', () => {
        const changed = sessionStore.detectTopicChange({
            previousState: {},
            incoming: { customerName: 'Bellafronte' },
            fields: FIELDS,
        })
        expect(changed).toBe(false)
    })

    it('ignores non-extractable fields (tool outputs) for topic change detection', () => {
        const changed = sessionStore.detectTopicChange({
            previousState: { customerMatches: [{ ndg: '1' }] },
            incoming: { customerMatches: [{ ndg: '2' }] },
            fields: FIELDS,
        })
        expect(changed).toBe(false)
    })
})

describe('sessionStore.applyStateOverwriteWithTopicChange', () => {
    it('overwrites existing value and wipes non-extractable downstream fields on topic change', () => {
        const flowState: Record<string, unknown> = {
            customerName: 'Bellafronte',
            customerMatches: [{ ndg: '11255521' }],
        }
        const result = sessionStore.applyStateOverwriteWithTopicChange({
            flowState,
            incoming: { customerName: 'Rossi' },
            fields: FIELDS,
        })
        expect(result.topicChanged).toBe(true)
        expect(flowState.customerName).toBe('Rossi')
        expect(flowState.customerMatches).toBeUndefined()
    })

    it('preserves non-extractable fields when there is no topic change', () => {
        const flowState: Record<string, unknown> = {
            customerName: 'Bellafronte',
            customerMatches: [{ ndg: '11255521' }],
        }
        const result = sessionStore.applyStateOverwriteWithTopicChange({
            flowState,
            incoming: { ndg: '11255521' },
            fields: FIELDS,
        })
        expect(result.topicChanged).toBe(false)
        expect(flowState.customerMatches).toEqual([{ ndg: '11255521' }])
        expect(flowState.ndg).toBe('11255521')
    })

    it('skips nil values in incoming (no false overwrite)', () => {
        const flowState: Record<string, unknown> = { customerName: 'Bellafronte' }
        const result = sessionStore.applyStateOverwriteWithTopicChange({
            flowState,
            incoming: { customerName: null, ndg: undefined },
            fields: FIELDS,
        })
        expect(result.topicChanged).toBe(false)
        expect(flowState.customerName).toBe('Bellafronte')
        expect('ndg' in flowState).toBe(false)
    })
})

describe('sessionStore.appendHistory', () => {
    it('appends new entry and enforces sliding window', () => {
        const base = Array.from({ length: 5 }, (_, i) => ({ role: 'user' as const, text: `t${i}` }))
        const updated = sessionStore.appendHistory({ history: base, role: 'assistant', text: 'new', historyMaxTurns: 4 })
        expect(updated).toHaveLength(4)
        expect(updated[updated.length - 1]).toEqual({ role: 'assistant', text: 'new' })
    })

    it('skips appending when text is empty or whitespace-only', () => {
        const base = [{ role: 'user' as const, text: 'ciao' }]
        const updated = sessionStore.appendHistory({ history: base, role: 'assistant', text: '   ', historyMaxTurns: 10 })
        expect(updated).toBe(base)
    })
})

describe('sessionStore.loadWithRevision (CAS GET)', () => {
    let fetchMock: ReturnType<typeof installFetchMock>
    beforeEach(() => {
        fetchMock = installFetchMock() 
    })
    afterEach(() => {
        vi.restoreAllMocks() 
    })

    it('returns sessionRevision=0 + record=null on 404', async () => {
        fetchMock.respondNotFound()
        const result = await sessionStore.loadWithRevision({
            key: 'ifsession:e:abc',
            constants: generateMockEngineConstants(),
            currentFlowVersionId: 'v1',
        })
        expect(result.record).toBeNull()
        expect(result.versionMismatch).toBe(false)
        expect(result.sessionRevision).toBe(0)
    })

    it('returns versionMismatch=true with retained version when flowVersionId differs', async () => {
        const stale: SessionRecord = {
            state: {}, history: [], flowVersionId: 'v-OLD', lastTurnAt: '2026-01-01T00:00:00Z',
        }
        fetchMock.respondGet({ value: stale, version: 7 })
        const result = await sessionStore.loadWithRevision({
            key: 'ifsession:e:abc',
            constants: generateMockEngineConstants(),
            currentFlowVersionId: 'v-NEW',
        })
        expect(result.versionMismatch).toBe(true)
        expect(result.sessionRevision).toBe(7)
    })

    it('returns matching record + version when flowVersionId equals', async () => {
        const current: SessionRecord = {
            state: { customerName: 'Polito' }, history: [],
            flowVersionId: 'v1', lastTurnAt: '2026-04-25T10:00:00Z',
        }
        fetchMock.respondGet({ value: current, version: 5 })
        const result = await sessionStore.loadWithRevision({
            key: 'ifsession:e:abc',
            constants: generateMockEngineConstants(),
            currentFlowVersionId: 'v1',
        })
        expect(result.record).toEqual(current)
        expect(result.sessionRevision).toBe(5)
        expect(result.versionMismatch).toBe(false)
    })

    it('falls back to legacy load on 5xx', async () => {
        fetchMock.respondGet(null, 500)
        fetchMock.respondNotFound()
        const result = await sessionStore.loadWithRevision({
            key: 'ifsession:e:abc',
            constants: generateMockEngineConstants(),
            currentFlowVersionId: 'v1',
        })
        expect(result.sessionRevision).toBe(0)
        expect(result.record).toBeNull()
    })

    it('falls back to legacy load on fetch throw', async () => {
        let calls = 0
        const spy = vi.fn(async () => {
            calls++
            if (calls === 1) throw new Error('ECONNREFUSED')
            return { ok: false, status: 404, json: async () => null, text: async () => '' } as unknown as Response
        })
        globalThis.fetch = spy as unknown as typeof fetch
        const result = await sessionStore.loadWithRevision({
            key: 'ifsession:e:abc',
            constants: generateMockEngineConstants(),
            currentFlowVersionId: 'v1',
        })
        expect(result.sessionRevision).toBe(0)
        expect(result.record).toBeNull()
    })
})

describe('sessionStore.saveWithCAS (CAS PUT)', () => {
    let fetchMock: ReturnType<typeof installFetchMock>
    beforeEach(() => {
        fetchMock = installFetchMock() 
    })
    afterEach(() => {
        vi.restoreAllMocks() 
    })

    it('returns ok with newRevision when server responds with version', async () => {
        fetchMock.respondGet({ version: 3 })
        const result = await sessionStore.saveWithCAS({
            key: 'ifsession:e:abc',
            constants: generateMockEngineConstants(),
            state: { customerName: 'Polito' },
            history: [],
            flowVersionId: 'v1',
            historyMaxTurns: 20,
            expectedRevision: 2,
        })
        expect(result.status).toBe('ok')
        expect(result.newRevision).toBe(3)
    })

    it('returns conflict on 412 with currentVersion', async () => {
        fetchMock.respondGet({ currentVersion: 9 }, 412)
        const result = await sessionStore.saveWithCAS({
            key: 'ifsession:e:abc',
            constants: generateMockEngineConstants(),
            state: {}, history: [], flowVersionId: 'v1', historyMaxTurns: 20, expectedRevision: 0,
        })
        expect(result.status).toBe('conflict')
        expect(result.currentRevision).toBe(9)
    })

    it('falls back to legacy save on non-412/5xx (e.g. 500)', async () => {
        fetchMock.respondGet(null, 500)
        fetchMock.respondPut()
        const result = await sessionStore.saveWithCAS({
            key: 'ifsession:e:abc',
            constants: generateMockEngineConstants(),
            state: {}, history: [], flowVersionId: 'v1', historyMaxTurns: 20, expectedRevision: 0,
        })
        expect(result.status).toBe('ok')
    })

    it('falls back to legacy save on fetch throw', async () => {
        let calls = 0
        const spy = vi.fn(async () => {
            calls++
            if (calls === 1) throw new Error('boom')
            return { ok: true, status: 200, json: async () => ({}), text: async () => '' } as unknown as Response
        })
        globalThis.fetch = spy as unknown as typeof fetch
        const result = await sessionStore.saveWithCAS({
            key: 'ifsession:e:abc',
            constants: generateMockEngineConstants(),
            state: {}, history: [], flowVersionId: 'v1', historyMaxTurns: 20, expectedRevision: 0,
        })
        expect(result.status).toBe('ok')
    })

    it('caps history before put when over historyMaxTurns', async () => {
        fetchMock.respondGet({ version: 1 })
        const longHistory = Array.from({ length: 30 }, (_, i) => ({ role: 'user' as const, text: `m${i}` }))
        await sessionStore.saveWithCAS({
            key: 'ifsession:e:abc',
            constants: generateMockEngineConstants(),
            state: {}, history: longHistory, flowVersionId: 'v1', historyMaxTurns: 5, expectedRevision: 0,
        })
        const body = JSON.parse(String(fetchMock.calls[0].init?.body))
        expect(body.value.history).toHaveLength(5)
        expect(body.expectedVersion).toBe(0)
    })

    it('persists pendingInteraction when provided', async () => {
        fetchMock.respondGet({ version: 1 })
        await sessionStore.saveWithCAS({
            key: 'ifsession:e:abc',
            constants: generateMockEngineConstants(),
            state: {}, history: [], flowVersionId: 'v1', historyMaxTurns: 20, expectedRevision: 0,
            pendingInteraction: { type: 'pending_cancel', createdAt: '2026-04-25T10:00:00Z' } as never,
        })
        const body = JSON.parse(String(fetchMock.calls[0].init?.body))
        expect(body.value.pendingInteraction).toBeDefined()
    })

    it('uses expectedRevision+1 when server omits version', async () => {
        fetchMock.respondGet({})
        const result = await sessionStore.saveWithCAS({
            key: 'ifsession:e:abc',
            constants: generateMockEngineConstants(),
            state: {}, history: [], flowVersionId: 'v1', historyMaxTurns: 20, expectedRevision: 4,
        })
        expect(result.newRevision).toBe(5)
    })
})

describe('sessionStore.buildDependencyGraph', () => {
    it('returns empty map for empty nodes', () => {
        const g = sessionStore.buildDependencyGraph({ nodes: [] })
        expect(g.size).toBe(0)
    })
    it('builds direct + transitive dependents for chained nodes', () => {
        const nodes = [
            { id: 'n1', stateInputs: ['customerName'], stateOutputs: ['accounts'] },
            { id: 'n2', stateInputs: ['accounts'], stateOutputs: ['caseId'] },
        ] as never
        const g = sessionStore.buildDependencyGraph({ nodes })
        expect(g.get('customerName')?.has('accounts')).toBe(true)
        expect(g.get('customerName')?.has('caseId')).toBe(true)
        expect(g.get('accounts')?.has('caseId')).toBe(true)
    })
})
