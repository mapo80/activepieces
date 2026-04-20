import { FlowAction, FlowActionType, InteractiveFlowAction, LoopOnItemsAction, RouterAction } from '../actions/action'
import { InteractiveFlowNode } from '../actions/interactive-flow-action'
import { FlowTrigger } from '../triggers/trigger'

type Step = FlowAction | FlowTrigger

type CanvasBBox = { minX: number, maxX: number, height: number }

function computeInteractiveFlowLayers(nodes: InteractiveFlowNode[]): Map<string, number> {
    const producer = new Map<string, string>()
    for (const n of nodes) {
        for (const out of n.stateOutputs) {
            if (!producer.has(out)) producer.set(out, n.id)
        }
    }
    const layer = new Map<string, number>()
    const visiting = new Set<string>()
    const nodesById = new Map<string, InteractiveFlowNode>(nodes.map(n => [n.id, n]))
    function resolve(nodeId: string): number {
        const cached = layer.get(nodeId)
        if (cached !== undefined) return cached
        if (visiting.has(nodeId)) return 0
        visiting.add(nodeId)
        const node = nodesById.get(nodeId)
        if (!node) {
            visiting.delete(nodeId)
            return 0
        }
        let maxUpstream = -1
        for (const input of node.stateInputs) {
            const upId = producer.get(input)
            if (upId && upId !== nodeId) {
                maxUpstream = Math.max(maxUpstream, resolve(upId))
            }
        }
        const level = maxUpstream + 1
        layer.set(nodeId, level)
        visiting.delete(nodeId)
        return level
    }
    for (const n of nodes) resolve(n.id)

    const consumersOf = new Map<string, string[]>()
    for (const n of nodes) {
        for (const input of n.stateInputs) {
            const upId = producer.get(input)
            if (!upId || upId === n.id) continue
            if (!consumersOf.has(upId)) consumersOf.set(upId, [])
            consumersOf.get(upId)!.push(n.id)
        }
    }
    for (const n of nodes) {
        if (n.stateInputs.length !== 0) continue
        const consumers = consumersOf.get(n.id)
        if (!consumers || consumers.length === 0) continue
        const minConsumerLayer = Math.min(...consumers.map(id => layer.get(id) ?? 0))
        const pushed = Math.max(0, minConsumerLayer - 1)
        if (pushed > (layer.get(n.id) ?? 0)) {
            layer.set(n.id, pushed)
        }
    }
    return layer
}

function interactiveFlowLayerStats(nodes: InteractiveFlowNode[]): { numLayers: number, maxNodesInLayer: number } {
    if (nodes.length === 0) return { numLayers: 0, maxNodesInLayer: 0 }
    const layers = computeInteractiveFlowLayers(nodes)
    const counts = new Map<number, number>()
    let maxLayer = 0
    for (const [, level] of layers) {
        counts.set(level, (counts.get(level) ?? 0) + 1)
        if (level > maxLayer) maxLayer = level
    }
    let maxNodesInLayer = 0
    for (const [, count] of counts) {
        if (count > maxNodesInLayer) maxNodesInLayer = count
    }
    return { numLayers: maxLayer + 1, maxNodesInLayer }
}

function interactiveFlowSubgraphHeight(nodes: InteractiveFlowNode[]): number {
    if (nodes.length === 0) return FLOW_CANVAS_STEP_HEIGHT + FLOW_CANVAS_VSPACE
    const { numLayers } = interactiveFlowLayerStats(nodes)
    const childrenHeight = numLayers * FLOW_CANVAS_INTERACTIVE_FLOW_CHILD_HEIGHT
        + Math.max(0, numLayers - 1) * FLOW_CANVAS_VSPACE
    const containerHeight = childrenHeight + 2 * FLOW_CANVAS_INTERACTIVE_FLOW_CONTAINER_PADDING
    return FLOW_CANVAS_STEP_HEIGHT
        + FLOW_CANVAS_VSPACE
        + containerHeight
        + FLOW_CANVAS_VSPACE
        + FLOW_CANVAS_STEP_HEIGHT
        + FLOW_CANVAS_VSPACE
}

function interactiveFlowSubgraphHorizontalSpan(nodes: InteractiveFlowNode[]): { minX: number, maxX: number } {
    if (nodes.length === 0) return { minX: 0, maxX: FLOW_CANVAS_STEP_WIDTH }
    const { maxNodesInLayer } = interactiveFlowLayerStats(nodes)
    if (maxNodesInLayer <= 1) return { minX: 0, maxX: FLOW_CANVAS_STEP_WIDTH }
    const layerWidth = maxNodesInLayer * FLOW_CANVAS_STEP_WIDTH
        + (maxNodesInLayer - 1) * FLOW_CANVAS_HSPACE
        + 2 * FLOW_CANVAS_INTERACTIVE_FLOW_CONTAINER_PADDING
    const parentCenter = FLOW_CANVAS_STEP_WIDTH / 2
    const minX = Math.min(0, parentCenter - layerWidth / 2)
    const maxX = Math.max(FLOW_CANVAS_STEP_WIDTH, parentCenter + layerWidth / 2)
    return { minX, maxX }
}

function getFlowBBox(step: Step | FlowAction | null | undefined, forBranch = false): CanvasBBox {
    if (!step) {
        return forBranch
            ? { minX: 0, maxX: FLOW_CANVAS_STEP_WIDTH, height: FLOW_CANVAS_STEP_HEIGHT + FLOW_CANVAS_VSPACE }
            : { minX: 0, maxX: FLOW_CANVAS_STEP_WIDTH, height: 0 }
    }

    let withChildMinX = 0
    let withChildMaxX = FLOW_CANVAS_STEP_WIDTH
    let withChildHeight = FLOW_CANVAS_STEP_HEIGHT + FLOW_CANVAS_VSPACE

    if (step.type === FlowActionType.LOOP_ON_ITEMS) {
        const loopStep = step as LoopOnItemsAction
        const childBBox = getFlowBBox(loopStep.firstLoopAction, true)
        const childWidth = childBBox.maxX - childBBox.minX
        const childLeft = -childBBox.minX + FLOW_CANVAS_STEP_WIDTH / 2
        const childRight = childBBox.maxX - FLOW_CANVAS_STEP_WIDTH / 2
        const deltaLeftX = -(childWidth + FLOW_CANVAS_STEP_WIDTH + FLOW_CANVAS_HSPACE - FLOW_CANVAS_STEP_WIDTH / 2 - childRight) / 2 - FLOW_CANVAS_STEP_WIDTH / 2
        const childOffsetX = deltaLeftX + FLOW_CANVAS_STEP_WIDTH + FLOW_CANVAS_HSPACE + childLeft
        const subgraphEndY = FLOW_CANVAS_STEP_HEIGHT + FLOW_CANVAS_LOOP_VOFFSET + childBBox.height + FLOW_CANVAS_ARC + FLOW_CANVAS_VSPACE
        withChildMinX = Math.min(0, deltaLeftX, childOffsetX + childBBox.minX)
        withChildMaxX = Math.max(FLOW_CANVAS_STEP_WIDTH, deltaLeftX + FLOW_CANVAS_STEP_WIDTH, childOffsetX + childBBox.maxX)
        withChildHeight = Math.max(FLOW_CANVAS_STEP_HEIGHT + FLOW_CANVAS_VSPACE, subgraphEndY)
    }
    else if (step.type === FlowActionType.ROUTER) {
        const routerStep = step as RouterAction
        const children = routerStep.children
        if (children.length > 0) {
            const childBBoxes = children.map(c => getFlowBBox(c, true))
            const totalWidth = childBBoxes.reduce((sum, b) => sum + (b.maxX - b.minX), 0) + FLOW_CANVAS_HSPACE * (children.length - 1)
            const firstLeft = -childBBoxes[0].minX + FLOW_CANVAS_STEP_WIDTH / 2
            const lastRight = childBBoxes[children.length - 1].maxX - FLOW_CANVAS_STEP_WIDTH / 2
            let deltaLeftX = -(totalWidth - firstLeft - lastRight) / 2 - firstLeft
            let routerMinX = 0
            let routerMaxX = FLOW_CANVAS_STEP_WIDTH
            let maxChildHeight = 0
            for (let i = 0; i < children.length; i++) {
                const bbox = childBBoxes[i]
                const x = deltaLeftX + (-bbox.minX + FLOW_CANVAS_STEP_WIDTH / 2)
                routerMinX = Math.min(routerMinX, x + bbox.minX)
                routerMaxX = Math.max(routerMaxX, x + bbox.maxX)
                maxChildHeight = Math.max(maxChildHeight, bbox.height)
                deltaLeftX += (bbox.maxX - bbox.minX) + FLOW_CANVAS_HSPACE
            }
            const subgraphEndY = FLOW_CANVAS_STEP_HEIGHT + FLOW_CANVAS_ROUTER_VOFFSET + maxChildHeight + FLOW_CANVAS_ARC + FLOW_CANVAS_VSPACE
            withChildMinX = routerMinX
            withChildMaxX = routerMaxX
            withChildHeight = Math.max(FLOW_CANVAS_STEP_HEIGHT + FLOW_CANVAS_VSPACE, subgraphEndY)
        }
    }
    else if (step.type === FlowActionType.INTERACTIVE_FLOW) {
        const iflowStep = step as InteractiveFlowAction
        const nodes = iflowStep.settings.nodes
        const { minX, maxX } = interactiveFlowSubgraphHorizontalSpan(nodes)
        withChildMinX = minX
        withChildMaxX = maxX
        withChildHeight = Math.max(
            FLOW_CANVAS_STEP_HEIGHT + FLOW_CANVAS_VSPACE,
            interactiveFlowSubgraphHeight(nodes),
        )
    }

    const nextBBox = getFlowBBox(step.nextAction, false)
    return {
        minX: Math.min(withChildMinX, nextBBox.minX),
        maxX: Math.max(withChildMaxX, nextBBox.maxX),
        height: withChildHeight + nextBBox.height,
    }
}

function buildPositions(
    step: Step | FlowAction | null | undefined,
    offsetX: number,
    offsetY: number,
    positions: Map<string, { x: number, y: number }>,
): void {
    if (!step) return

    positions.set(step.name, { x: offsetX + FLOW_CANVAS_STEP_WIDTH / 2, y: offsetY })

    if (step.type === FlowActionType.LOOP_ON_ITEMS) {
        const loopStep = step as LoopOnItemsAction
        const childBBox = getFlowBBox(loopStep.firstLoopAction, true)
        const childLeft = -childBBox.minX + FLOW_CANVAS_STEP_WIDTH / 2
        const childRight = childBBox.maxX - FLOW_CANVAS_STEP_WIDTH / 2
        const childWidth = childBBox.maxX - childBBox.minX
        const deltaLeftX = -(childWidth + FLOW_CANVAS_STEP_WIDTH + FLOW_CANVAS_HSPACE - FLOW_CANVAS_STEP_WIDTH / 2 - childRight) / 2 - FLOW_CANVAS_STEP_WIDTH / 2
        const childOffsetX = offsetX + deltaLeftX + FLOW_CANVAS_STEP_WIDTH + FLOW_CANVAS_HSPACE + childLeft
        const childOffsetY = offsetY + FLOW_CANVAS_STEP_HEIGHT + FLOW_CANVAS_LOOP_VOFFSET
        if (loopStep.firstLoopAction) {
            buildPositions(loopStep.firstLoopAction, childOffsetX, childOffsetY, positions)
        }
        const subgraphEndY = FLOW_CANVAS_STEP_HEIGHT + FLOW_CANVAS_LOOP_VOFFSET + childBBox.height + FLOW_CANVAS_ARC + FLOW_CANVAS_VSPACE
        buildPositions(step.nextAction, offsetX, offsetY + subgraphEndY, positions)
    }
    else if (step.type === FlowActionType.ROUTER) {
        const routerStep = step as RouterAction
        const children = routerStep.children
        const childBBoxes = children.map(c => getFlowBBox(c, true))
        let maxChildHeight = 0
        if (children.length > 0) {
            const totalWidth = childBBoxes.reduce((sum, b) => sum + (b.maxX - b.minX), 0) + FLOW_CANVAS_HSPACE * (children.length - 1)
            const firstLeft = -childBBoxes[0].minX + FLOW_CANVAS_STEP_WIDTH / 2
            const lastRight = childBBoxes[children.length - 1].maxX - FLOW_CANVAS_STEP_WIDTH / 2
            let deltaLeftX = -(totalWidth - firstLeft - lastRight) / 2 - firstLeft
            const childOffsetY = offsetY + FLOW_CANVAS_STEP_HEIGHT + FLOW_CANVAS_ROUTER_VOFFSET
            for (let i = 0; i < children.length; i++) {
                const child = children[i]
                const bbox = childBBoxes[i]
                const branchOffsetX = offsetX + deltaLeftX + (-bbox.minX + FLOW_CANVAS_STEP_WIDTH / 2)
                if (child) {
                    buildPositions(child, branchOffsetX, childOffsetY, positions)
                }
                maxChildHeight = Math.max(maxChildHeight, bbox.height)
                deltaLeftX += (bbox.maxX - bbox.minX) + FLOW_CANVAS_HSPACE
            }
        }
        const subgraphEndY = FLOW_CANVAS_STEP_HEIGHT + FLOW_CANVAS_ROUTER_VOFFSET + maxChildHeight + FLOW_CANVAS_ARC + FLOW_CANVAS_VSPACE
        buildPositions(step.nextAction, offsetX, offsetY + subgraphEndY, positions)
    }
    else if (step.type === FlowActionType.INTERACTIVE_FLOW) {
        const iflowStep = step as InteractiveFlowAction
        const subgraphEndY = interactiveFlowSubgraphHeight(iflowStep.settings.nodes)
        buildPositions(step.nextAction, offsetX, offsetY + subgraphEndY, positions)
    }
    else {
        buildPositions(step.nextAction, offsetX, offsetY + FLOW_CANVAS_STEP_HEIGHT + FLOW_CANVAS_VSPACE, positions)
    }
}

export const FLOW_CANVAS_STEP_HEIGHT = 60
export const FLOW_CANVAS_STEP_WIDTH = 232
export const FLOW_CANVAS_VSPACE = 60
export const FLOW_CANVAS_ARC = 15
export const FLOW_CANVAS_LOOP_VOFFSET = FLOW_CANVAS_VSPACE * 1.5 + 2 * FLOW_CANVAS_ARC // 120
export const FLOW_CANVAS_ROUTER_VOFFSET = FLOW_CANVAS_LOOP_VOFFSET + 30 // 150
export const FLOW_CANVAS_HSPACE = 80
export const FLOW_CANVAS_INTERACTIVE_FLOW_CHILD_HEIGHT = 44
export const FLOW_CANVAS_INTERACTIVE_FLOW_CONTAINER_PADDING = 24

export const flowCanvasUtils = {
    /**
     * Compute canvas (x, y) positions for every step in a flow.
     * Positions match the frontend canvas layout algorithm.
     */
    computeStepPositions(trigger: FlowTrigger): Map<string, { x: number, y: number }> {
        const positions = new Map<string, { x: number, y: number }>()
        buildPositions(trigger, 0, 0, positions)
        return positions
    },
    computeInteractiveFlowLayers,
    interactiveFlowLayerStats,
    interactiveFlowSubgraphHeight,
    interactiveFlowSubgraphHorizontalSpan,
}
