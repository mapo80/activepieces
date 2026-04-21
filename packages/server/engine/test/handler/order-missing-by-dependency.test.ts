import {
    InteractiveFlowNode,
    InteractiveFlowNodeType,
} from '@activepieces/shared'
import { describe, expect, it } from 'vitest'
import {
    buildVirtualNodeAddendum,
    orderMissingByDependency,
} from '../../src/lib/handler/interactive-flow-executor'

function toolNode({ id, inputs, outputs }: { id: string; inputs: string[]; outputs: string[] }): InteractiveFlowNode {
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

function userInputNode({ id, inputs, outputs }: { id: string; inputs: string[]; outputs: string[] }): InteractiveFlowNode {
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
    toolNode({ id: 'search_customer', inputs: ['customerName'], outputs: ['customerMatches'] }),
    userInputNode({ id: 'pick_ndg', inputs: ['customerMatches'], outputs: ['ndg'] }),
    toolNode({ id: 'load_profile', inputs: ['ndg'], outputs: ['profile'] }),
    toolNode({ id: 'load_accounts', inputs: ['ndg'], outputs: ['accounts'] }),
    userInputNode({ id: 'pick_rapporto', inputs: ['accounts'], outputs: ['rapportoId'] }),
    toolNode({ id: 'load_reasons', inputs: ['rapportoId'], outputs: ['closureReasons'] }),
    userInputNode({
        id: 'collect_reason_and_date',
        inputs: ['closureReasons'],
        outputs: ['closureReasonCode', 'closureDate'],
    }),
    toolNode({
        id: 'generate_pdf',
        inputs: ['ndg', 'rapportoId', 'closureReasonCode', 'closureDate'],
        outputs: ['moduleBase64'],
    }),
]

describe('orderMissingByDependency — graph-aware root detection', () => {
    it('estinzione flow with empty state → customerName is first (not ndg)', () => {
        const missing = ['customerName', 'ndg', 'rapportoId', 'closureReasonCode', 'closureDate']
        const result = orderMissingByDependency({ missing, nodes: ESTINZIONE_NODES })
        expect(result[0]).toBe('customerName')
    })

    it('after customerName is resolved, ndg becomes the root', () => {
        const missing = ['ndg', 'rapportoId', 'closureReasonCode', 'closureDate']
        const result = orderMissingByDependency({ missing, nodes: ESTINZIONE_NODES })
        expect(result[0]).toBe('ndg')
    })

    it('BRANCH node with non-empty stateOutputs is treated as producer', () => {
        const branchNode: InteractiveFlowNode = {
            id: 'maybe_route',
            name: 'maybe_route',
            displayName: 'maybe_route',
            nodeType: InteractiveFlowNodeType.BRANCH,
            stateInputs: ['a'],
            stateOutputs: ['routeChoice'],
            branches: [],
        } as unknown as InteractiveFlowNode
        const nodes: InteractiveFlowNode[] = [
            toolNode({ id: 't1', inputs: [], outputs: ['a'] }),
            branchNode,
        ]
        const missing = ['a', 'routeChoice']
        const result = orderMissingByDependency({ missing, nodes })
        expect(result[0]).toBe('a')
    })

    it('multi-producer of same field: conservative — field is NOT root if ANY producer has upstream missing', () => {
        const nodes: InteractiveFlowNode[] = [
            toolNode({ id: 'producer_a', inputs: ['u'], outputs: ['x'] }),
            toolNode({ id: 'producer_b', inputs: [], outputs: ['x'] }),
        ]
        const missing = ['u', 'x']
        const result = orderMissingByDependency({ missing, nodes })
        expect(result[0]).toBe('u')
    })

    it('cyclic graph a ↔ b: no infinite loop, returns both as non-root due to missing upstream via self-ref', () => {
        const nodes: InteractiveFlowNode[] = [
            toolNode({ id: 'n1', inputs: ['a'], outputs: ['b'] }),
            toolNode({ id: 'n2', inputs: ['b'], outputs: ['a'] }),
        ]
        const missing = ['a', 'b']
        const result = orderMissingByDependency({ missing, nodes })
        expect(result.sort()).toEqual(['a', 'b'])
    })

    it('field with no producer node goes first (firstNodeOrder=-1)', () => {
        const nodes: InteractiveFlowNode[] = [
            toolNode({ id: 'n1', inputs: ['orphan'], outputs: ['derived'] }),
        ]
        const missing = ['orphan', 'derived']
        const result = orderMissingByDependency({ missing, nodes })
        expect(result[0]).toBe('orphan')
    })

    it('empty missing array returns empty', () => {
        const result = orderMissingByDependency({ missing: [], nodes: ESTINZIONE_NODES })
        expect(result).toEqual([])
    })
})

describe('buildVirtualNodeAddendum', () => {
    it('IT locale produces Italian prompt with flowLabel + primaryLabel + primaryDesc', () => {
        const addendum = buildVirtualNodeAddendum({
            primaryField: 'customerName',
            primaryLabel: 'Nome cliente',
            primaryDesc: 'cognome o nome+cognome',
            flowLabel: 'estinzione del rapporto',
            locale: 'it',
        })
        expect(addendum).toContain('italiano')
        expect(addendum).toContain('estinzione del rapporto')
        expect(addendum).toContain('Nome cliente')
        expect(addendum).toContain('cognome o nome+cognome')
        expect(addendum).toContain('customerName')
        expect(addendum).not.toContain('Conversation just started')
    })

    it('EN locale produces English prompt with same placeholders', () => {
        const addendum = buildVirtualNodeAddendum({
            primaryField: 'customerName',
            primaryLabel: 'Customer name',
            primaryDesc: 'last name or first+last',
            flowLabel: 'account closure',
            locale: 'en',
        })
        expect(addendum).toContain('Conversation just started')
        expect(addendum).toContain('account closure')
        expect(addendum).toContain('Customer name')
        expect(addendum).not.toContain('italiano')
    })

    it('missing primaryDesc does not leave empty parentheses', () => {
        const addendum = buildVirtualNodeAddendum({
            primaryField: 'ndg',
            primaryLabel: 'NDG',
            primaryDesc: undefined,
            flowLabel: 'estinzione',
            locale: 'it',
        })
        expect(addendum).not.toMatch(/\(\s*\)/)
    })
})
