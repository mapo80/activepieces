import { describe, expect, it } from 'vitest'
import {
    FlowActionType,
    FlowTrigger,
    FlowTriggerType,
    InteractiveFlowAction,
    InteractiveFlowNode,
    InteractiveFlowNodeType,
} from '../../../src'
import {
    FLOW_CANVAS_INTERACTIVE_FLOW_CHILD_HEIGHT,
    FLOW_CANVAS_INTERACTIVE_FLOW_CONTAINER_PADDING,
    FLOW_CANVAS_STEP_HEIGHT,
    FLOW_CANVAS_STEP_WIDTH,
    FLOW_CANVAS_VSPACE,
    FLOW_CANVAS_HSPACE,
    flowCanvasUtils,
} from '../../../src/lib/automation/flows/util/flow-canvas-util'

function toolNode({ id, stateInputs = [], stateOutputs = [] }: { id: string, stateInputs?: string[], stateOutputs?: string[] }): InteractiveFlowNode {
    return {
        id,
        name: id,
        displayName: id,
        nodeType: InteractiveFlowNodeType.TOOL,
        tool: 'test/tool',
        stateInputs,
        stateOutputs,
    }
}

function buildInteractiveFlowStep({ name, nodes, nextAction }: { name: string, nodes: InteractiveFlowNode[], nextAction?: InteractiveFlowAction['nextAction'] }): InteractiveFlowAction {
    return {
        name,
        displayName: name,
        type: FlowActionType.INTERACTIVE_FLOW,
        skip: false,
        valid: true,
        lastUpdatedDate: new Date().toISOString(),
        settings: {
            nodes,
            stateFields: [],
        },
        nextAction,
    }
}

function buildTriggerWithIFlow({ interactiveFlow }: { interactiveFlow: InteractiveFlowAction }): FlowTrigger {
    return {
        name: 'trigger',
        displayName: 'Trigger',
        type: FlowTriggerType.EMPTY,
        settings: {},
        valid: true,
        skip: false,
        lastUpdatedDate: new Date().toISOString(),
        nextAction: interactiveFlow,
    } as unknown as FlowTrigger
}

describe('computeInteractiveFlowLayers', () => {
    it('empty nodes → empty map', () => {
        const layers = flowCanvasUtils.computeInteractiveFlowLayers([])
        expect(layers.size).toBe(0)
    })

    it('single node with no inputs → layer 0', () => {
        const layers = flowCanvasUtils.computeInteractiveFlowLayers([
            toolNode({ id: 'a', stateOutputs: ['x'] }),
        ])
        expect(layers.get('a')).toBe(0)
    })

    it('linear chain A → B → C → D (3 layers)', () => {
        const layers = flowCanvasUtils.computeInteractiveFlowLayers([
            toolNode({ id: 'a', stateOutputs: ['x'] }),
            toolNode({ id: 'b', stateInputs: ['x'], stateOutputs: ['y'] }),
            toolNode({ id: 'c', stateInputs: ['y'], stateOutputs: ['z'] }),
            toolNode({ id: 'd', stateInputs: ['z'] }),
        ])
        expect(layers.get('a')).toBe(0)
        expect(layers.get('b')).toBe(1)
        expect(layers.get('c')).toBe(2)
        expect(layers.get('d')).toBe(3)
    })

    it('Estinzione-like: L2 has two parallel nodes', () => {
        // search_customer → pick_ndg → (load_profile || load_accounts) → pick_rapporto
        const layers = flowCanvasUtils.computeInteractiveFlowLayers([
            toolNode({ id: 'search', stateInputs: ['customerName'], stateOutputs: ['customerMatches'] }),
            toolNode({ id: 'pick_ndg', stateInputs: ['customerMatches'], stateOutputs: ['ndg'] }),
            toolNode({ id: 'load_profile', stateInputs: ['ndg'], stateOutputs: ['profile'] }),
            toolNode({ id: 'load_accounts', stateInputs: ['ndg'], stateOutputs: ['accounts'] }),
            toolNode({ id: 'pick_rapporto', stateInputs: ['accounts'], stateOutputs: ['rapportoId'] }),
        ])
        expect(layers.get('search')).toBe(0)
        expect(layers.get('pick_ndg')).toBe(1)
        expect(layers.get('load_profile')).toBe(2)
        expect(layers.get('load_accounts')).toBe(2)
        expect(layers.get('pick_rapporto')).toBe(3)
    })

    it('skip-connection: generate_pdf reads from multiple earlier layers', () => {
        const layers = flowCanvasUtils.computeInteractiveFlowLayers([
            toolNode({ id: 'a', stateOutputs: ['ndg'] }),
            toolNode({ id: 'b', stateInputs: ['ndg'], stateOutputs: ['rapportoId'] }),
            toolNode({ id: 'c', stateInputs: ['rapportoId'], stateOutputs: ['reasons'] }),
            toolNode({ id: 'd', stateInputs: ['reasons'], stateOutputs: ['code'] }),
            toolNode({ id: 'pdf', stateInputs: ['ndg', 'rapportoId', 'code'], stateOutputs: ['pdfData'] }),
        ])
        expect(layers.get('pdf')).toBe(4)
    })
})

describe('interactiveFlowLayerStats', () => {
    it('empty nodes → 0 layers, 0 max', () => {
        const stats = flowCanvasUtils.interactiveFlowLayerStats([])
        expect(stats.numLayers).toBe(0)
        expect(stats.maxNodesInLayer).toBe(0)
    })

    it('linear chain of 5 → 5 layers, 1 max per layer', () => {
        const nodes = Array.from({ length: 5 }).map((_, i) => toolNode({
            id: `n${i}`,
            stateInputs: i === 0 ? [] : [`f${i - 1}`],
            stateOutputs: [`f${i}`],
        }))
        const stats = flowCanvasUtils.interactiveFlowLayerStats(nodes)
        expect(stats.numLayers).toBe(5)
        expect(stats.maxNodesInLayer).toBe(1)
    })

    it('fan-out at layer 1: 1 → (A, B, C)', () => {
        const stats = flowCanvasUtils.interactiveFlowLayerStats([
            toolNode({ id: 'root', stateOutputs: ['x'] }),
            toolNode({ id: 'a', stateInputs: ['x'], stateOutputs: ['a_out'] }),
            toolNode({ id: 'b', stateInputs: ['x'], stateOutputs: ['b_out'] }),
            toolNode({ id: 'c', stateInputs: ['x'], stateOutputs: ['c_out'] }),
        ])
        expect(stats.numLayers).toBe(2)
        expect(stats.maxNodesInLayer).toBe(3)
    })
})

describe('interactiveFlowSubgraphHeight', () => {
    it('empty → base height', () => {
        expect(flowCanvasUtils.interactiveFlowSubgraphHeight([])).toBe(FLOW_CANVAS_STEP_HEIGHT + FLOW_CANVAS_VSPACE)
    })

    it('1 layer of 1 node → includes container padding + return + end', () => {
        const h = flowCanvasUtils.interactiveFlowSubgraphHeight([
            toolNode({ id: 'a' }),
        ])
        const expected = FLOW_CANVAS_STEP_HEIGHT + FLOW_CANVAS_VSPACE
            + (FLOW_CANVAS_INTERACTIVE_FLOW_CHILD_HEIGHT + 2 * FLOW_CANVAS_INTERACTIVE_FLOW_CONTAINER_PADDING)
            + FLOW_CANVAS_VSPACE + FLOW_CANVAS_STEP_HEIGHT + FLOW_CANVAS_VSPACE
        expect(h).toBe(expected)
    })

    it('10 layers linear (Estinzione original) → height grows as numLayers * CHILD_HEIGHT', () => {
        const nodes = Array.from({ length: 10 }).map((_, i) => toolNode({
            id: `n${i}`,
            stateInputs: i === 0 ? [] : [`f${i - 1}`],
            stateOutputs: [`f${i}`],
        }))
        const h = flowCanvasUtils.interactiveFlowSubgraphHeight(nodes)
        const childrenHeight = 10 * FLOW_CANVAS_INTERACTIVE_FLOW_CHILD_HEIGHT + 9 * FLOW_CANVAS_VSPACE
        const expected = FLOW_CANVAS_STEP_HEIGHT + FLOW_CANVAS_VSPACE
            + (childrenHeight + 2 * FLOW_CANVAS_INTERACTIVE_FLOW_CONTAINER_PADDING)
            + FLOW_CANVAS_VSPACE + FLOW_CANVAS_STEP_HEIGHT + FLOW_CANVAS_VSPACE
        expect(h).toBe(expected)
    })

    it('parallel nodes in same layer do not add extra vertical space', () => {
        const linear = flowCanvasUtils.interactiveFlowSubgraphHeight([
            toolNode({ id: 'a', stateOutputs: ['x'] }),
            toolNode({ id: 'b', stateInputs: ['x'] }),
        ])
        const parallel = flowCanvasUtils.interactiveFlowSubgraphHeight([
            toolNode({ id: 'a', stateOutputs: ['x'] }),
            toolNode({ id: 'b', stateInputs: ['x'] }),
            toolNode({ id: 'c', stateInputs: ['x'] }),
        ])
        expect(parallel).toBe(linear)
    })
})

describe('interactiveFlowSubgraphHorizontalSpan', () => {
    it('empty → default STEP_WIDTH span', () => {
        const span = flowCanvasUtils.interactiveFlowSubgraphHorizontalSpan([])
        expect(span).toEqual({ minX: 0, maxX: FLOW_CANVAS_STEP_WIDTH })
    })

    it('single-node-per-layer chain → default STEP_WIDTH span', () => {
        const span = flowCanvasUtils.interactiveFlowSubgraphHorizontalSpan([
            toolNode({ id: 'a', stateOutputs: ['x'] }),
            toolNode({ id: 'b', stateInputs: ['x'] }),
        ])
        expect(span).toEqual({ minX: 0, maxX: FLOW_CANVAS_STEP_WIDTH })
    })

    it('3 parallel nodes → wider span centered on parent', () => {
        const span = flowCanvasUtils.interactiveFlowSubgraphHorizontalSpan([
            toolNode({ id: 'root', stateOutputs: ['x'] }),
            toolNode({ id: 'a', stateInputs: ['x'] }),
            toolNode({ id: 'b', stateInputs: ['x'] }),
            toolNode({ id: 'c', stateInputs: ['x'] }),
        ])
        const width = span.maxX - span.minX
        const expectedLayerWidth = 3 * FLOW_CANVAS_STEP_WIDTH + 2 * FLOW_CANVAS_HSPACE + 2 * FLOW_CANVAS_INTERACTIVE_FLOW_CONTAINER_PADDING
        expect(width).toBeGreaterThanOrEqual(expectedLayerWidth)
        expect(span.minX).toBeLessThan(0)
        expect(span.maxX).toBeGreaterThan(FLOW_CANVAS_STEP_WIDTH)
    })
})

describe('flowCanvasUtils.computeStepPositions: INTERACTIVE_FLOW next step placement', () => {
    it('next step after an interactive flow does not overlap subgraph', () => {
        const nextStep = {
            name: 'next',
            displayName: 'Next',
            type: FlowActionType.CODE,
            skip: false,
            valid: true,
            lastUpdatedDate: new Date().toISOString(),
            settings: {},
        } as unknown as InteractiveFlowAction['nextAction']

        const iflow = buildInteractiveFlowStep({
            name: 'iflow',
            nodes: [
                toolNode({ id: 'a', stateOutputs: ['x'] }),
                toolNode({ id: 'b', stateInputs: ['x'], stateOutputs: ['y'] }),
                toolNode({ id: 'c', stateInputs: ['y'] }),
            ],
            nextAction: nextStep,
        })
        const trigger = buildTriggerWithIFlow({ interactiveFlow: iflow })
        const positions = flowCanvasUtils.computeStepPositions(trigger)

        const iflowPos = positions.get('iflow')
        const nextPos = positions.get('next')
        expect(iflowPos).toBeDefined()
        expect(nextPos).toBeDefined()
        expect(nextPos!.y).toBeGreaterThan(iflowPos!.y
            + FLOW_CANVAS_STEP_HEIGHT
            + 3 * FLOW_CANVAS_INTERACTIVE_FLOW_CHILD_HEIGHT
            + 2 * FLOW_CANVAS_VSPACE)
    })

    it('fallback (no INTERACTIVE_FLOW branch) would overlap: regression guard', () => {
        const nextStep = {
            name: 'next',
            displayName: 'Next',
            type: FlowActionType.CODE,
            skip: false,
            valid: true,
            lastUpdatedDate: new Date().toISOString(),
            settings: {},
        } as unknown as InteractiveFlowAction['nextAction']

        const iflow = buildInteractiveFlowStep({
            name: 'iflow',
            nodes: Array.from({ length: 8 }).map((_, i) => toolNode({
                id: `n${i}`,
                stateInputs: i === 0 ? [] : [`f${i - 1}`],
                stateOutputs: [`f${i}`],
            })),
            nextAction: nextStep,
        })
        const trigger = buildTriggerWithIFlow({ interactiveFlow: iflow })
        const positions = flowCanvasUtils.computeStepPositions(trigger)

        const iflowPos = positions.get('iflow')!
        const nextPos = positions.get('next')!
        const subgraphBottom = iflowPos.y + flowCanvasUtils.interactiveFlowSubgraphHeight(iflow.settings.nodes)
        expect(nextPos.y).toBeGreaterThanOrEqual(subgraphBottom - FLOW_CANVAS_VSPACE)
    })
})
