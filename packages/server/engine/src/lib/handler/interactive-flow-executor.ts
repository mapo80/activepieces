import { EngineGenericError, FlowActionType, FlowRunStatus, GenericStepOutput, InteractiveFlowAction, InteractiveFlowNode, InteractiveFlowNodeType, isNil, PauseType, ResolveMcpGatewayResponse, StepOutputStatus } from '@activepieces/shared'
import { BaseExecutor } from './base-executor'
import { EngineConstants } from './context/engine-constants'
import { FlowExecutorContext } from './context/flow-execution-context'

type InteractiveFlowState = Record<string, unknown>

type InteractiveFlowOutput = {
    state: InteractiveFlowState
    executedNodeIds: string[]
    currentNodeId?: string
}

function findReadyToolNodes({ nodes, state, executedNodeIds }: {
    nodes: InteractiveFlowNode[]
    state: InteractiveFlowState
    executedNodeIds: string[]
}): InteractiveFlowNode[] {
    return nodes.filter(node =>
        !executedNodeIds.includes(node.id) &&
        node.stateInputs.every(field => !isNil(state[field])) &&
        node.nodeType === InteractiveFlowNodeType.TOOL,
    )
}

function findNextUserNode({ nodes, state, executedNodeIds }: {
    nodes: InteractiveFlowNode[]
    state: InteractiveFlowState
    executedNodeIds: string[]
}): InteractiveFlowNode | null {
    return nodes.find(node =>
        !executedNodeIds.includes(node.id) &&
        (node.nodeType === InteractiveFlowNodeType.USER_INPUT || node.nodeType === InteractiveFlowNodeType.CONFIRM) &&
        node.stateInputs.every(field => !isNil(state[field])) &&
        node.stateOutputs.some(field => isNil(state[field])),
    ) ?? null
}

function buildToolParams({ node, state }: {
    node: InteractiveFlowNode
    state: InteractiveFlowState
}): Record<string, unknown> {
    if (isNil(node.toolParams)) {
        return {}
    }
    return Object.fromEntries(
        Object.entries(node.toolParams).map(([param, stateField]) => [param, state[stateField]]),
    )
}

function mapOutputsToState({ node, result, state }: {
    node: InteractiveFlowNode
    result: unknown
    state: InteractiveFlowState
}): void {
    if (node.stateOutputs.length === 1) {
        state[node.stateOutputs[0]] = result
        return
    }
    if (typeof result === 'object' && result !== null) {
        for (const field of node.stateOutputs) {
            if (field in (result as Record<string, unknown>)) {
                state[field] = (result as Record<string, unknown>)[field]
            }
        }
    }
}

async function resolveGateway({ gatewayId, constants }: {
    gatewayId: string
    constants: EngineConstants
}): Promise<ResolveMcpGatewayResponse> {
    const url = `${constants.internalApiUrl}v1/engine/mcp-gateways/${encodeURIComponent(gatewayId)}/resolve`
    let response: Response
    try {
        response = await fetch(url, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${constants.engineToken}`,
            },
        })
    }
    catch (error) {
        throw new EngineGenericError('McpGatewayResolveFailed', `Could not reach the MCP gateway resolver: ${(error as Error).message}`)
    }
    if (!response.ok) {
        throw new EngineGenericError('McpGatewayResolveFailed', `MCP gateway resolver returned HTTP ${response.status}`)
    }
    return await response.json() as ResolveMcpGatewayResponse
}

async function executeTool({ toolName, params, gateway }: {
    toolName: string
    params: Record<string, unknown>
    gateway: ResolveMcpGatewayResponse
}): Promise<unknown> {
    const response = await fetch(gateway.url, {
        method: 'POST',
        headers: gateway.headers,
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: toolName, arguments: params },
        }),
    })
    if (!response.ok) {
        throw new EngineGenericError('McpToolCallFailed', `MCP tool call failed with status ${response.status}`)
    }
    const json = await response.json() as Record<string, unknown>
    const result = json.result as Record<string, unknown> | undefined
    const content = result?.content as Array<Record<string, unknown>> | undefined
    if (content?.[0]?.text && typeof content[0].text === 'string') {
        try {
            return JSON.parse(content[0].text)
        }
        catch {
            return content[0].text
        }
    }
    return result
}

function hasCircularDependency({ nodes }: { nodes: InteractiveFlowNode[] }): boolean {
    const outputToNode = new Map<string, string>()
    for (const node of nodes) {
        for (const output of node.stateOutputs) {
            outputToNode.set(output, node.id)
        }
    }
    const visited = new Set<string>()
    const visiting = new Set<string>()

    function dfs(nodeId: string): boolean {
        if (visiting.has(nodeId)) {
            return true
        }
        if (visited.has(nodeId)) {
            return false
        }
        visiting.add(nodeId)
        const node = nodes.find(n => n.id === nodeId)
        if (node) {
            for (const input of node.stateInputs) {
                const depNodeId = outputToNode.get(input)
                if (depNodeId && dfs(depNodeId)) {
                    return true
                }
            }
        }
        visiting.delete(nodeId)
        visited.add(nodeId)
        return false
    }

    return nodes.some(node => dfs(node.id))
}

export const interactiveFlowExecutor: BaseExecutor<InteractiveFlowAction> = {
    async handle({ action, executionState, constants }: {
        action: InteractiveFlowAction
        executionState: FlowExecutorContext
        constants: EngineConstants
    }): Promise<FlowExecutorContext> {
        if (executionState.isCompleted({ stepName: action.name })) {
            return executionState
        }

        const { settings } = action
        const nodes = settings.nodes

        if (nodes.length === 0) {
            const stepOutput = GenericStepOutput.create({
                type: FlowActionType.INTERACTIVE_FLOW,
                status: StepOutputStatus.SUCCEEDED,
                input: {},
                output: { state: {}, executedNodeIds: [] },
            })
            return executionState.upsertStep(action.name, stepOutput)
        }

        if (hasCircularDependency({ nodes })) {
            throw new EngineGenericError('CircularDependency', 'Circular dependency detected in interactive flow nodes')
        }

        const previousOutput = executionState.getStepOutput(action.name)
        const prevFlowOutput = previousOutput?.output as InteractiveFlowOutput | undefined
        const flowState: InteractiveFlowState = { ...(prevFlowOutput?.state ?? {}) }
        const executedNodeIds: string[] = [...(prevFlowOutput?.executedNodeIds ?? [])]

        if (constants.resumePayload?.body && typeof constants.resumePayload.body === 'object') {
            Object.assign(flowState, constants.resumePayload.body)
        }

        let gateway: ResolveMcpGatewayResponse | null = null
        const ensureGateway = async (): Promise<ResolveMcpGatewayResponse> => {
            if (!isNil(gateway)) {
                return gateway
            }
            if (isNil(settings.mcpGatewayId)) {
                throw new EngineGenericError('McpGatewayNotConfigured', 'No MCP gateway selected in the interactive flow settings')
            }
            gateway = await resolveGateway({ gatewayId: settings.mcpGatewayId, constants })
            return gateway
        }

        let changed = true
        while (changed) {
            changed = false
            const readyNodes = findReadyToolNodes({ nodes, state: flowState, executedNodeIds })
            for (const node of readyNodes) {
                if (isNil(node.tool)) {
                    continue
                }
                try {
                    const params = buildToolParams({ node, state: flowState })
                    const resolvedGateway = await ensureGateway()
                    const result = await executeTool({ toolName: node.tool, params, gateway: resolvedGateway })
                    mapOutputsToState({ node, result, state: flowState })
                }
                catch (error) {
                    const stepOutput = GenericStepOutput.create({
                        type: FlowActionType.INTERACTIVE_FLOW,
                        status: StepOutputStatus.FAILED,
                        input: {},
                        output: { state: flowState, executedNodeIds, currentNodeId: node.id },
                    }).setErrorMessage(error instanceof Error ? error.message : 'Tool execution failed')
                    return executionState
                        .upsertStep(action.name, stepOutput)
                        .setVerdict({
                            status: FlowRunStatus.FAILED,
                            failedStep: {
                                name: action.name,
                                displayName: action.displayName,
                                message: `Tool ${node.tool} failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                            },
                        })
                }
                executedNodeIds.push(node.id)
                changed = true
            }
        }

        const nextUserNode = findNextUserNode({ nodes, state: flowState, executedNodeIds })

        if (nextUserNode) {
            const stepOutput = GenericStepOutput.create({
                type: FlowActionType.INTERACTIVE_FLOW,
                status: StepOutputStatus.PAUSED,
                input: {},
                output: { state: flowState, executedNodeIds, currentNodeId: nextUserNode.id },
            })
            return executionState
                .upsertStep(action.name, stepOutput)
                .setVerdict({
                    status: FlowRunStatus.PAUSED,
                    pauseMetadata: {
                        type: PauseType.WEBHOOK,
                        requestId: action.name,
                        response: {
                            status: 200,
                            body: {
                                message: nextUserNode.message ?? '',
                                render: nextUserNode.render ?? null,
                                interactiveFlowState: flowState,
                            },
                            headers: {},
                        },
                    },
                })
        }

        const stepOutput = GenericStepOutput.create({
            type: FlowActionType.INTERACTIVE_FLOW,
            status: StepOutputStatus.SUCCEEDED,
            input: {},
            output: { state: flowState, executedNodeIds },
        })
        return executionState.upsertStep(action.name, stepOutput)
    },
}
