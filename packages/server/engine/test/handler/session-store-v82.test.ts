import {
    InteractiveFlowNode,
    InteractiveFlowNodeType,
    InteractiveFlowStateField,
    PendingInteraction,
} from '@activepieces/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sessionStore, SessionRecord } from '../../src/lib/handler/session-store'
import { generateMockEngineConstants } from './test-helper'

const FIELDS: InteractiveFlowStateField[] = [
    { name: 'customerName', type: 'string', extractable: true },
    { name: 'ndg', type: 'string', extractable: true },
    { name: 'rapportoId', type: 'string', extractable: true },
    { name: 'closureDate', type: 'date', extractable: true },
    { name: 'closureReasonCode', type: 'string', extractable: true },
    { name: 'customerMatches', type: 'array', extractable: false },
    { name: 'accounts', type: 'array', extractable: false },
    { name: 'profile', type: 'object', extractable: false },
    { name: 'closureReasons', type: 'array', extractable: false },
    { name: 'moduleBase64', type: 'string', extractable: false },
    { name: 'confirmed', type: 'boolean', extractable: false },
    { name: 'caseId', type: 'string', extractable: false },
]

function toolNode({ id, inputs, outputs }: { id: string, inputs: string[], outputs: string[] }): InteractiveFlowNode {
    return {
        id,
        name: id,
        displayName: id,
        nodeType: InteractiveFlowNodeType.TOOL,
        stateInputs: inputs,
        stateOutputs: outputs,
        tool: 'fake',
    } as InteractiveFlowNode
}

function userInputNode({ id, inputs, outputs }: { id: string, inputs: string[], outputs: string[] }): InteractiveFlowNode {
    return {
        id,
        name: id,
        displayName: id,
        nodeType: InteractiveFlowNodeType.USER_INPUT,
        stateInputs: inputs,
        stateOutputs: outputs,
        message: { en: 'msg' },
        render: { component: 'text', props: {} },
    } as InteractiveFlowNode
}

const ESTINZIONE_NODES: InteractiveFlowNode[] = [
    userInputNode({ id: 'ask_customer', inputs: [], outputs: ['customerName'] }),
    toolNode({ id: 'find_customers', inputs: ['customerName'], outputs: ['customerMatches'] }),
    userInputNode({ id: 'pick_ndg', inputs: ['customerMatches'], outputs: ['ndg'] }),
    toolNode({ id: 'get_profile', inputs: ['ndg'], outputs: ['profile'] }),
    toolNode({ id: 'get_accounts', inputs: ['ndg'], outputs: ['accounts'] }),
    userInputNode({ id: 'pick_rapporto', inputs: ['accounts'], outputs: ['rapportoId'] }),
    toolNode({ id: 'list_reasons', inputs: [], outputs: ['closureReasons'] }),
    userInputNode({
        id: 'collect_reason_and_date',
        inputs: ['closureReasons'],
        outputs: ['closureReasonCode', 'closureDate'],
    }),
    toolNode({
        id: 'generate_module',
        inputs: ['customerName', 'ndg', 'rapportoId', 'closureReasonCode', 'closureDate'],
        outputs: ['moduleBase64'],
    }),
    userInputNode({
        id: 'confirm_closure',
        inputs: ['moduleBase64'],
        outputs: ['confirmed'],
    }),
    toolNode({
        id: 'submit_case',
        inputs: ['confirmed', 'customerName', 'ndg', 'rapportoId', 'closureReasonCode', 'closureDate'],
        outputs: ['caseId'],
    }),
]

describe('sessionStore.buildDependencyGraph', () => {
    it('returns empty graph for empty nodes', () => {
        const graph = sessionStore.buildDependencyGraph({ nodes: [] })
        expect(graph.size).toBe(0)
    })

    it('customerName → downstream includes customerMatches, ndg, profile, accounts, rapportoId, moduleBase64, confirmed, caseId', () => {
        const graph = sessionStore.buildDependencyGraph({ nodes: ESTINZIONE_NODES })
        const downstream = graph.get('customerName')
        expect(downstream).toBeDefined()
        expect(downstream!.has('customerMatches')).toBe(true)
        expect(downstream!.has('ndg')).toBe(true)
        expect(downstream!.has('profile')).toBe(true)
        expect(downstream!.has('accounts')).toBe(true)
        expect(downstream!.has('rapportoId')).toBe(true)
        expect(downstream!.has('moduleBase64')).toBe(true)
        expect(downstream!.has('confirmed')).toBe(true)
        expect(downstream!.has('caseId')).toBe(true)
    })

    it('closureDate → downstream includes moduleBase64 and caseId only (isolated subtree)', () => {
        const graph = sessionStore.buildDependencyGraph({ nodes: ESTINZIONE_NODES })
        const downstream = graph.get('closureDate')
        expect(downstream).toBeDefined()
        expect(downstream!.has('moduleBase64')).toBe(true)
        expect(downstream!.has('caseId')).toBe(true)
        expect(downstream!.has('customerName')).toBe(false)
        expect(downstream!.has('ndg')).toBe(false)
        expect(downstream!.has('rapportoId')).toBe(false)
    })

    it('does not include source field in its own downstream set', () => {
        const graph = sessionStore.buildDependencyGraph({ nodes: ESTINZIONE_NODES })
        const downstream = graph.get('customerName')
        expect(downstream!.has('customerName')).toBe(false)
    })

    it('ndg → downstream includes profile, accounts, rapportoId, moduleBase64, confirmed, caseId', () => {
        const graph = sessionStore.buildDependencyGraph({ nodes: ESTINZIONE_NODES })
        const downstream = graph.get('ndg')
        expect(downstream!.has('profile')).toBe(true)
        expect(downstream!.has('accounts')).toBe(true)
        expect(downstream!.has('rapportoId')).toBe(true)
        expect(downstream!.has('moduleBase64')).toBe(true)
    })

    it('skips nodes with no inputs or no outputs', () => {
        const nodes: InteractiveFlowNode[] = [
            userInputNode({ id: 'a', inputs: [], outputs: ['x'] }),
            toolNode({ id: 'b', inputs: ['y'], outputs: [] }),
            toolNode({ id: 'c', inputs: ['x'], outputs: ['z'] }),
        ]
        const graph = sessionStore.buildDependencyGraph({ nodes })
        expect(graph.get('x')?.has('z')).toBe(true)
        expect(graph.has('y')).toBe(false)
    })

    it('handles cyclic node graphs without infinite loops', () => {
        const nodes: InteractiveFlowNode[] = [
            toolNode({ id: 'n1', inputs: ['a'], outputs: ['b'] }),
            toolNode({ id: 'n2', inputs: ['b'], outputs: ['a'] }),
        ]
        const graph = sessionStore.buildDependencyGraph({ nodes })
        expect(graph.get('a')?.has('b')).toBe(true)
        expect(graph.get('b')?.has('a')).toBe(true)
    })
})

describe('sessionStore.applyStateOverwriteWithTopicChange with graph-aware invalidation', () => {
    it('customerName change invalidates downstream only, not closureDate', () => {
        const flowState: Record<string, unknown> = {
            customerName: 'Bellafronte',
            customerMatches: [{ ndg: '111' }],
            ndg: '111',
            profile: { any: 'profile' },
            accounts: [{ id: 'a' }],
            rapportoId: '01-034-00392400',
            closureDate: '2026-04-15',
            closureReasonCode: '01',
        }
        const result = sessionStore.applyStateOverwriteWithTopicChange({
            flowState,
            incoming: { customerName: 'Rossi' },
            fields: FIELDS,
            nodes: ESTINZIONE_NODES,
        })
        expect(result.topicChanged).toBe(true)
        expect(flowState.customerName).toBe('Rossi')
        expect(flowState.customerMatches).toBeUndefined()
        expect(flowState.ndg).toBeUndefined()
        expect(flowState.profile).toBeUndefined()
        expect(flowState.accounts).toBeUndefined()
        expect(flowState.rapportoId).toBeUndefined()
        expect(flowState.closureDate).toBe('2026-04-15')
        expect(flowState.closureReasonCode).toBe('01')
        expect(result.clearedKeys).toEqual(expect.arrayContaining(['customerMatches', 'ndg', 'profile', 'accounts', 'rapportoId']))
        expect(result.clearedKeys).not.toContain('closureDate')
    })

    it('closureDate change invalidates only moduleBase64/caseId, not customer/ndg/rapporto', () => {
        const flowState: Record<string, unknown> = {
            customerName: 'Bellafronte',
            ndg: '11255521',
            rapportoId: '01-034-00392400',
            closureReasonCode: '01',
            closureDate: '2026-04-15',
            moduleBase64: 'aGVsbG8=',
        }
        const result = sessionStore.applyStateOverwriteWithTopicChange({
            flowState,
            incoming: { closureDate: '2026-04-20' },
            fields: FIELDS,
            nodes: ESTINZIONE_NODES,
        })
        expect(result.topicChanged).toBe(true)
        expect(flowState.closureDate).toBe('2026-04-20')
        expect(flowState.moduleBase64).toBeUndefined()
        expect(flowState.customerName).toBe('Bellafronte')
        expect(flowState.ndg).toBe('11255521')
        expect(flowState.rapportoId).toBe('01-034-00392400')
        expect(result.clearedKeys).toContain('moduleBase64')
        expect(result.clearedKeys).not.toContain('customerName')
    })

    it('batch apply with customerName + ndg: does not clear keys present in the batch', () => {
        const flowState: Record<string, unknown> = {
            customerName: 'Bellafronte',
            ndg: '11255521',
            customerMatches: [{ ndg: '11255521' }],
            profile: { foo: 'bar' },
        }
        const result = sessionStore.applyStateOverwriteWithTopicChange({
            flowState,
            incoming: { customerName: 'Rossi', ndg: '99999999' },
            fields: FIELDS,
            nodes: ESTINZIONE_NODES,
        })
        expect(result.topicChanged).toBe(true)
        expect(flowState.customerName).toBe('Rossi')
        expect(flowState.ndg).toBe('99999999')
        expect(flowState.customerMatches).toBeUndefined()
        expect(flowState.profile).toBeUndefined()
        expect(result.clearedKeys).not.toContain('customerName')
        expect(result.clearedKeys).not.toContain('ndg')
    })

    it('falls back to clear-all-non-extractable when nodes not provided (retro-compat)', () => {
        const flowState: Record<string, unknown> = {
            customerName: 'Bellafronte',
            customerMatches: [{ ndg: '111' }],
            profile: { anything: true },
            moduleBase64: 'base64',
        }
        const result = sessionStore.applyStateOverwriteWithTopicChange({
            flowState,
            incoming: { customerName: 'Rossi' },
            fields: FIELDS,
        })
        expect(result.topicChanged).toBe(true)
        expect(flowState.customerMatches).toBeUndefined()
        expect(flowState.profile).toBeUndefined()
        expect(flowState.moduleBase64).toBeUndefined()
    })

    it('no topic change → does not invoke graph invalidation', () => {
        const flowState: Record<string, unknown> = {
            customerName: 'Bellafronte',
            customerMatches: [{ ndg: '111' }],
        }
        const result = sessionStore.applyStateOverwriteWithTopicChange({
            flowState,
            incoming: { ndg: '111' },
            fields: FIELDS,
            nodes: ESTINZIONE_NODES,
        })
        expect(result.topicChanged).toBe(false)
        expect(flowState.customerMatches).toEqual([{ ndg: '111' }])
        expect(flowState.ndg).toBe('111')
        expect(result.clearedKeys).toHaveLength(0)
    })

    it('empty nodes array triggers retro-compat fallback (same as nodes undefined)', () => {
        const flowState: Record<string, unknown> = {
            customerName: 'Bellafronte',
            customerMatches: [{ ndg: '111' }],
        }
        const result = sessionStore.applyStateOverwriteWithTopicChange({
            flowState,
            incoming: { customerName: 'Rossi' },
            fields: FIELDS,
            nodes: [],
        })
        expect(result.topicChanged).toBe(true)
        expect(flowState.customerMatches).toBeUndefined()
    })
})

describe('sessionStore.save/load round-trip pendingInteraction', () => {
    let calls: Array<{ url: string, init: RequestInit | undefined }>
    let queue: Array<() => Response>

    function installFetchMock(): void {
        calls = []
        queue = []
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
    }

    beforeEach(() => { installFetchMock() })
    afterEach(() => { vi.restoreAllMocks() })

    it('persists pendingInteraction through save and round-trips it via load', async () => {
        queue.push(() => ({
            ok: true, status: 200,
            json: async () => ({}), text: async () => '',
        } as unknown as Response))

        const pending: PendingInteraction = {
            type: 'pick_from_list',
            field: 'ndg',
            options: [
                { ordinal: 1, label: 'ROSSI MARIO', value: '111' },
                { ordinal: 2, label: 'ROSSI GIULIO', value: '222' },
            ],
            nodeId: 'pick_ndg',
        }

        await sessionStore.save({
            key: 'ifsession:estinzione:abc',
            constants: generateMockEngineConstants(),
            state: { customerName: 'Rossi' },
            history: [{ role: 'user', text: 'cerco Rossi' }],
            flowVersionId: 'v1',
            historyMaxTurns: 20,
            pendingInteraction: pending,
        })

        const putBody = JSON.parse(String(calls[0].init?.body)) as { value: SessionRecord }
        expect(putBody.value.pendingInteraction).toEqual(pending)

        queue.push(() => ({
            ok: true, status: 200,
            json: async () => ({ value: putBody.value }), text: async () => JSON.stringify({ value: putBody.value }),
        } as unknown as Response))

        const loaded = await sessionStore.load({
            key: 'ifsession:estinzione:abc',
            constants: generateMockEngineConstants(),
            currentFlowVersionId: 'v1',
        })
        expect(loaded.record?.pendingInteraction).toEqual(pending)
    })

    it('omits pendingInteraction from the record when not provided', async () => {
        queue.push(() => ({
            ok: true, status: 200,
            json: async () => ({}), text: async () => '',
        } as unknown as Response))

        await sessionStore.save({
            key: 'ifsession:estinzione:abc',
            constants: generateMockEngineConstants(),
            state: {},
            history: [],
            flowVersionId: 'v1',
            historyMaxTurns: 20,
        })
        const body = JSON.parse(String(calls[0].init?.body)) as { value: SessionRecord }
        expect('pendingInteraction' in body.value).toBe(false)
    })

    it('supports all PendingInteraction variants (confirm_binary, pending_overwrite, open_text)', async () => {
        const variants: PendingInteraction[] = [
            { type: 'confirm_binary', field: 'confirmed', target: true, nodeId: 'confirm_closure' },
            { type: 'pending_overwrite', field: 'customerName', oldValue: 'Bellafronte', newValue: 'Rossi', nodeId: 'pick_ndg' },
            { type: 'open_text', field: 'closureReasonCode', nodeId: 'collect_reason' },
        ]
        for (const pending of variants) {
            queue.push(() => ({
                ok: true, status: 200,
                json: async () => ({}), text: async () => '',
            } as unknown as Response))
            calls.length = 0
            await sessionStore.save({
                key: 'ifsession:estinzione:abc',
                constants: generateMockEngineConstants(),
                state: {},
                history: [],
                flowVersionId: 'v1',
                historyMaxTurns: 20,
                pendingInteraction: pending,
            })
            const body = JSON.parse(String(calls[0].init?.body)) as { value: SessionRecord }
            expect(body.value.pendingInteraction).toEqual(pending)
        }
    })
})
