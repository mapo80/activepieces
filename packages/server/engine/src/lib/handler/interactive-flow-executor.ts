import {
    EngineGenericError,
    FlowActionType,
    FlowRunStatus,
    GenericStepOutput,
    InteractiveFlowAction,
    InteractiveFlowActionSettings,
    InteractiveFlowBranchNode,
    InteractiveFlowConfirmNode,
    InteractiveFlowErrorPolicy,
    InteractiveFlowNode,
    InteractiveFlowNodeType,
    InteractiveFlowStateField,
    InteractiveFlowToolNode,
    InteractiveFlowUserInputNode,
    isNil,
    LocalizedString,
    NodeMessage,
    ParamBinding,
    PauseType,
    ResolveMcpGatewayResponse,
    StepOutputStatus,
} from '@activepieces/shared'
import { BaseExecutor } from './base-executor'
import { EngineConstants } from './context/engine-constants'
import { FlowExecutorContext } from './context/flow-execution-context'

type InteractiveFlowState = Record<string, unknown>

type InteractiveFlowOutput = {
    state: InteractiveFlowState
    executedNodeIds: string[]
    skippedNodeIds?: string[]
    currentNodeId?: string
    failedNodeId?: string
    selectedBranches?: Record<string, string>
}

const DEFAULT_LOCALE = 'en'
const DEFAULT_TOOL_TIMEOUT_MS = 60_000

function isToolNode(node: InteractiveFlowNode): node is InteractiveFlowToolNode {
    return node.nodeType === InteractiveFlowNodeType.TOOL
}

function isUserInputNode(node: InteractiveFlowNode): node is InteractiveFlowUserInputNode {
    return node.nodeType === InteractiveFlowNodeType.USER_INPUT
}

function isConfirmNode(node: InteractiveFlowNode): node is InteractiveFlowConfirmNode {
    return node.nodeType === InteractiveFlowNodeType.CONFIRM
}

function isBranchNode(node: InteractiveFlowNode): node is InteractiveFlowBranchNode {
    return node.nodeType === InteractiveFlowNodeType.BRANCH
}

function resolveParamBinding({ binding, state }: {
    binding: ParamBinding
    state: InteractiveFlowState
}): unknown {
    switch (binding.kind) {
        case 'state':
            return state[binding.field]
        case 'literal':
            return binding.value
        case 'compose':
            return Object.fromEntries(binding.fields.map(f => [f, state[f]]))
    }
}

function buildToolParams({ node, state }: {
    node: InteractiveFlowToolNode
    state: InteractiveFlowState
}): Record<string, unknown> {
    if (isNil(node.toolParams)) {
        return {}
    }
    return Object.fromEntries(
        Object.entries(node.toolParams).map(([param, binding]) => [param, resolveParamBinding({ binding, state })]),
    )
}

function coerceStateValue({ value, field }: {
    value: unknown
    field: InteractiveFlowStateField
}): unknown {
    if (isNil(value)) return value
    switch (field.type) {
        case 'string':
            return typeof value === 'string' ? value : String(value)
        case 'number': {
            if (typeof value === 'number') return value
            const n = Number(value)
            return Number.isFinite(n) ? n : value
        }
        case 'boolean':
            return Boolean(value)
        case 'array':
            return Array.isArray(value) ? value : [value]
        case 'object':
            if (typeof value === 'object') return value
            if (typeof value === 'string') {
                try {
                    return JSON.parse(value)
                }
                catch {
                    return value
                }
            }
            return value
        case 'date':
            return typeof value === 'string' ? value : String(value)
    }
}

function coerceIncomingState({ incoming, fields }: {
    incoming: Record<string, unknown>
    fields: InteractiveFlowStateField[]
}): Record<string, unknown> {
    const fieldsByName = new Map(fields.map(f => [f.name, f]))
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(incoming)) {
        const field = fieldsByName.get(key)
        out[key] = isNil(field) ? value : coerceStateValue({ value, field })
    }
    return out
}

function mapOutputsToState({ node, result, state, fields }: {
    node: InteractiveFlowToolNode
    result: unknown
    state: InteractiveFlowState
    fields: InteractiveFlowStateField[]
}): void {
    const fieldsByName = new Map(fields.map(f => [f.name, f]))
    const outputMap = node.outputMap ?? {}
    const resultObj = typeof result === 'object' && result !== null ? result as Record<string, unknown> : null
    if (node.stateOutputs.length === 1) {
        const target = node.stateOutputs[0]
        const source = outputMap[target]
        const value = isNil(source) ? result : resultObj ? resultObj[source] : result
        const field = fieldsByName.get(target)
        state[target] = isNil(field) ? value : coerceStateValue({ value, field })
        return
    }
    if (isNil(resultObj)) return
    for (const target of node.stateOutputs) {
        const source = outputMap[target] ?? target
        if (source in resultObj) {
            const field = fieldsByName.get(target)
            const value = resultObj[source]
            state[target] = isNil(field) ? value : coerceStateValue({ value, field })
        }
    }
}

function redactSensitiveState({ state, fields }: {
    state: InteractiveFlowState
    fields: InteractiveFlowStateField[]
}): InteractiveFlowState {
    const sensitive = new Set(fields.filter(f => f.sensitive).map(f => f.name))
    if (sensitive.size === 0) return state
    const out: InteractiveFlowState = {}
    for (const [k, v] of Object.entries(state)) {
        if (!sensitive.has(k)) out[k] = v
    }
    return out
}

function resolveLocale({ constants, settings }: {
    constants: EngineConstants
    settings: InteractiveFlowActionSettings
}): string {
    const resumeLocale = (constants.resumePayload?.body as Record<string, unknown> | undefined)?.locale
    if (typeof resumeLocale === 'string' && resumeLocale.length > 0) return resumeLocale
    if (!isNil(settings.locale)) return settings.locale
    return DEFAULT_LOCALE
}

function resolveLocalizedString({ value, locale }: {
    value: LocalizedString | string | undefined
    locale: string
}): string | undefined {
    if (isNil(value)) return undefined
    if (typeof value === 'string') return value
    if (value[locale]) return value[locale]
    if (value[DEFAULT_LOCALE]) return value[DEFAULT_LOCALE]
    const firstKey = Object.keys(value)[0]
    return firstKey ? value[firstKey] : undefined
}

function resolveNodeMessage({ message, locale }: {
    message: NodeMessage | string | undefined
    locale: string
}): string | undefined {
    if (isNil(message)) return undefined
    if (typeof message === 'string') return message
    if (typeof message === 'object' && 'dynamic' in message && message.dynamic === true) {
        return resolveLocalizedString({ value: message.fallback, locale })
    }
    return resolveLocalizedString({ value: message as LocalizedString, locale })
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
            headers: { Authorization: `Bearer ${constants.engineToken}` },
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

async function executeToolWithPolicy({ node, params, gateway, policy }: {
    node: InteractiveFlowToolNode
    params: Record<string, unknown>
    gateway: ResolveMcpGatewayResponse
    policy: InteractiveFlowErrorPolicy | undefined
}): Promise<unknown> {
    const timeoutMs = policy?.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS
    const maxRetries = policy?.maxRetries ?? 0
    let lastError: Error | undefined
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        try {
            const response = await fetch(gateway.url, {
                method: 'POST',
                headers: gateway.headers,
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'tools/call',
                    params: { name: node.tool, arguments: params },
                }),
                signal: controller.signal,
            })
            clearTimeout(timer)
            if (!response.ok) {
                if (response.status >= 500 && attempt < maxRetries) {
                    lastError = new Error(`MCP tool call failed with status ${response.status}`)
                    await backoff(attempt)
                    continue
                }
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
        catch (error) {
            clearTimeout(timer)
            lastError = error as Error
            if (attempt < maxRetries) {
                await backoff(attempt)
                continue
            }
            throw error
        }
    }
    throw lastError ?? new EngineGenericError('McpToolCallFailed', 'Tool call exhausted retries')
}

async function backoff(attempt: number): Promise<void> {
    const delayMs = Math.min(1000 * Math.pow(2, attempt), 10_000)
    await new Promise(resolve => setTimeout(resolve, delayMs))
}

function propagateSkip({ fromNodeId, nodes, skippedNodeIds }: {
    fromNodeId: string
    nodes: InteractiveFlowNode[]
    skippedNodeIds: Set<string>
}): void {
    skippedNodeIds.add(fromNodeId)
    const node = nodes.find(n => n.id === fromNodeId)
    if (!node) return
    const producedFields = isBranchNode(node) ? [] : node.stateOutputs
    for (const other of nodes) {
        if (other.id === fromNodeId) continue
        if (skippedNodeIds.has(other.id)) continue
        if (producedFields.some(f => other.stateInputs.includes(f))) {
            propagateSkip({ fromNodeId: other.id, nodes, skippedNodeIds })
        }
    }
}

function findReadyToolNodes({ nodes, state, executedNodeIds, skippedNodeIds }: {
    nodes: InteractiveFlowNode[]
    state: InteractiveFlowState
    executedNodeIds: Set<string>
    skippedNodeIds: Set<string>
}): InteractiveFlowToolNode[] {
    return nodes.filter((node): node is InteractiveFlowToolNode =>
        isToolNode(node) &&
        !executedNodeIds.has(node.id) &&
        !skippedNodeIds.has(node.id) &&
        node.stateInputs.every(field => !isNil(state[field])),
    )
}

function findReadyBranchNodes({ nodes, state, executedNodeIds, skippedNodeIds }: {
    nodes: InteractiveFlowNode[]
    state: InteractiveFlowState
    executedNodeIds: Set<string>
    skippedNodeIds: Set<string>
}): InteractiveFlowBranchNode[] {
    return nodes.filter((node): node is InteractiveFlowBranchNode =>
        isBranchNode(node) &&
        !executedNodeIds.has(node.id) &&
        !skippedNodeIds.has(node.id) &&
        node.stateInputs.every(field => !isNil(state[field])),
    )
}

function findNextUserOrConfirmNode({ nodes, state, executedNodeIds, skippedNodeIds }: {
    nodes: InteractiveFlowNode[]
    state: InteractiveFlowState
    executedNodeIds: Set<string>
    skippedNodeIds: Set<string>
}): InteractiveFlowUserInputNode | InteractiveFlowConfirmNode | null {
    return (nodes.find((node): node is InteractiveFlowUserInputNode | InteractiveFlowConfirmNode =>
        (isUserInputNode(node) || isConfirmNode(node)) &&
        !executedNodeIds.has(node.id) &&
        !skippedNodeIds.has(node.id) &&
        node.stateInputs.every(field => !isNil(state[field])) &&
        node.stateOutputs.some(field => isNil(state[field])),
    )) ?? null
}

function evaluateBranchSimply({ branch, state }: {
    branch: InteractiveFlowBranchNode['branches'][number]
    state: InteractiveFlowState
}): boolean {
    if (branch.branchType === 'FALLBACK') return true
    // Minimal evaluator for v1: check each condition group (OR across groups, AND inside each group).
    // Supports TEXT_EXACTLY_MATCHES, NUMBER_IS_EQUAL_TO, BOOLEAN_IS_TRUE/FALSE, EXISTS/DOES_NOT_EXIST as a baseline.
    // Full evaluator parity with ROUTER's evaluateConditions lives in a follow-up alongside richer condition UI.
    for (const group of branch.conditions) {
        const allMatch = group.every((raw) => {
            const condition = raw as { operator?: string, firstValue?: unknown, secondValue?: unknown }
            const op = condition.operator ?? 'TEXT_EXACTLY_MATCHES'
            const fv = substituteTemplate(condition.firstValue, state)
            const sv = substituteTemplate(condition.secondValue, state)
            switch (op) {
                case 'TEXT_EXACTLY_MATCHES':
                    return String(fv) === String(sv)
                case 'TEXT_DOES_NOT_EXACTLY_MATCH':
                    return String(fv) !== String(sv)
                case 'TEXT_CONTAINS':
                    return String(fv).includes(String(sv))
                case 'NUMBER_IS_EQUAL_TO':
                    return Number(fv) === Number(sv)
                case 'NUMBER_IS_GREATER_THAN':
                    return Number(fv) > Number(sv)
                case 'NUMBER_IS_LESS_THAN':
                    return Number(fv) < Number(sv)
                case 'BOOLEAN_IS_TRUE':
                    return Boolean(fv) === true
                case 'BOOLEAN_IS_FALSE':
                    return Boolean(fv) === false
                case 'EXISTS':
                    return !isNil(fv) && fv !== ''
                case 'DOES_NOT_EXIST':
                    return isNil(fv) || fv === ''
                default:
                    return false
            }
        })
        if (allMatch) return true
    }
    return false
}

function substituteTemplate(raw: unknown, state: InteractiveFlowState): unknown {
    if (typeof raw !== 'string') return raw
    return raw.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_, key: string) => {
        const v = state[key]
        return typeof v === 'string' ? v : JSON.stringify(v)
    })
}

function applyBranch({ node, state, nodes, executedNodeIds, skippedNodeIds, selectedBranches }: {
    node: InteractiveFlowBranchNode
    state: InteractiveFlowState
    nodes: InteractiveFlowNode[]
    executedNodeIds: Set<string>
    skippedNodeIds: Set<string>
    selectedBranches: Record<string, string>
}): void {
    let selected = node.branches.find(b => b.branchType !== 'FALLBACK' && evaluateBranchSimply({ branch: b, state }))
    if (isNil(selected)) {
        selected = node.branches.find(b => b.branchType === 'FALLBACK')
    }
    if (isNil(selected)) {
        propagateSkip({ fromNodeId: node.id, nodes, skippedNodeIds })
        return
    }
    selectedBranches[node.id] = selected.id
    const reachableNodeIds = new Set(selected.targetNodeIds)
    // Nodes that are targets of a non-selected branch but not the selected one → skipped
    for (const branch of node.branches) {
        if (branch.id === selected.id) continue
        for (const target of branch.targetNodeIds) {
            if (!reachableNodeIds.has(target)) {
                propagateSkip({ fromNodeId: target, nodes, skippedNodeIds })
            }
        }
    }
    executedNodeIds.add(node.id)
}

function isAlreadyWritten({ node, state }: {
    node: InteractiveFlowNode
    state: InteractiveFlowState
}): boolean {
    if (node.stateOutputs.length === 0) return false
    return node.stateOutputs.every(f => !isNil(state[f]))
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
        const fields = settings.stateFields

        if (nodes.length === 0) {
            const stepOutput = GenericStepOutput.create({
                type: FlowActionType.INTERACTIVE_FLOW,
                status: StepOutputStatus.SUCCEEDED,
                input: {},
                output: { state: {}, executedNodeIds: [] },
            })
            return executionState.upsertStep(action.name, stepOutput)
        }

        const previousOutput = executionState.getStepOutput(action.name)
        const prevFlowOutput = previousOutput?.output as InteractiveFlowOutput | undefined
        const flowState: InteractiveFlowState = { ...(prevFlowOutput?.state ?? {}) }
        const executedNodeIds = new Set<string>(prevFlowOutput?.executedNodeIds ?? [])
        const skippedNodeIds = new Set<string>(prevFlowOutput?.skippedNodeIds ?? [])
        const selectedBranches: Record<string, string> = { ...(prevFlowOutput?.selectedBranches ?? {}) }

        if (constants.resumePayload?.body && typeof constants.resumePayload.body === 'object') {
            const incoming = constants.resumePayload.body as Record<string, unknown>
            const coerced = coerceIncomingState({ incoming, fields })
            for (const [k, v] of Object.entries(coerced)) {
                if (k === 'locale' || k === 'message') continue
                flowState[k] = v
            }
        }

        // Nodes with outputs already satisfied = already executed (e.g. field extractor pre-filled them)
        for (const node of nodes) {
            if (executedNodeIds.has(node.id) || skippedNodeIds.has(node.id)) continue
            if (!isBranchNode(node) && isAlreadyWritten({ node, state: flowState })) {
                executedNodeIds.add(node.id)
            }
        }

        let gateway: ResolveMcpGatewayResponse | null = null
        const ensureGateway = async (): Promise<ResolveMcpGatewayResponse> => {
            if (!isNil(gateway)) return gateway
            if (isNil(settings.mcpGatewayId)) {
                throw new EngineGenericError('McpGatewayNotConfigured', 'No MCP gateway selected in the interactive flow settings')
            }
            gateway = await resolveGateway({ gatewayId: settings.mcpGatewayId, constants })
            return gateway
        }

        let changed = true
        while (changed) {
            changed = false

            for (const branchNode of findReadyBranchNodes({ nodes, state: flowState, executedNodeIds, skippedNodeIds })) {
                applyBranch({
                    node: branchNode,
                    state: flowState,
                    nodes,
                    executedNodeIds,
                    skippedNodeIds,
                    selectedBranches,
                })
                changed = true
            }

            const readyTools = findReadyToolNodes({ nodes, state: flowState, executedNodeIds, skippedNodeIds })
            for (const node of readyTools) {
                const policy = node.errorPolicy
                try {
                    const params = buildToolParams({ node, state: flowState })
                    const resolvedGateway = await ensureGateway()
                    const result = await executeToolWithPolicy({ node, params, gateway: resolvedGateway, policy })
                    mapOutputsToState({ node, result, state: flowState, fields })
                    executedNodeIds.add(node.id)
                }
                catch (error) {
                    const onFailure = policy?.onFailure ?? 'FAIL'
                    if (onFailure === 'SKIP') {
                        propagateSkip({ fromNodeId: node.id, nodes, skippedNodeIds })
                    }
                    else if (onFailure === 'CONTINUE') {
                        executedNodeIds.add(node.id)
                    }
                    else {
                        const stepOutput = GenericStepOutput.create({
                            type: FlowActionType.INTERACTIVE_FLOW,
                            status: StepOutputStatus.FAILED,
                            input: {},
                            output: {
                                state: flowState,
                                executedNodeIds: Array.from(executedNodeIds),
                                skippedNodeIds: Array.from(skippedNodeIds),
                                failedNodeId: node.id,
                                selectedBranches,
                            },
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
                }
                changed = true
            }
        }

        const locale = resolveLocale({ constants, settings })
        const nextPauseNode = findNextUserOrConfirmNode({ nodes, state: flowState, executedNodeIds, skippedNodeIds })

        const hasUnresolvedToolOrBranch = nodes.some(n =>
            (isToolNode(n) || isBranchNode(n)) &&
            !executedNodeIds.has(n.id) &&
            !skippedNodeIds.has(n.id),
        )
        if (isNil(nextPauseNode) && hasUnresolvedToolOrBranch) {
            throw new EngineGenericError(
                'InteractiveFlowDeadlock',
                'Circular dependency detected: one or more nodes cannot run because their required inputs are never produced',
            )
        }

        if (nextPauseNode) {
            const message = resolveNodeMessage({ message: nextPauseNode.message, locale })
            const visibleState = redactSensitiveState({ state: flowState, fields })
            const stepOutput = GenericStepOutput.create({
                type: FlowActionType.INTERACTIVE_FLOW,
                status: StepOutputStatus.PAUSED,
                input: {},
                output: {
                    state: flowState,
                    executedNodeIds: Array.from(executedNodeIds),
                    skippedNodeIds: Array.from(skippedNodeIds),
                    currentNodeId: nextPauseNode.id,
                    selectedBranches,
                },
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
                                message: message ?? '',
                                render: nextPauseNode.render ?? null,
                                locale,
                                interactiveFlowState: visibleState,
                                nodeId: nextPauseNode.id,
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
            output: {
                state: flowState,
                executedNodeIds: Array.from(executedNodeIds),
                skippedNodeIds: Array.from(skippedNodeIds),
                selectedBranches,
            },
        })
        return executionState.upsertStep(action.name, stepOutput)
    },
}
