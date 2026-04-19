import { FlowRunStatus, InteractiveFlowNodeType, StepOutputStatus } from '@activepieces/shared'
import { FlowExecutorContext } from '../../src/lib/handler/context/flow-execution-context'
import { StepExecutionPath } from '../../src/lib/handler/context/step-execution-path'
import { flowExecutor } from '../../src/lib/handler/flow-executor'
import { buildCodeAction, buildInteractiveFlowAction, generateMockEngineConstants } from './test-helper'

const mockFetchResponse = (data: unknown): Promise<Response> => {
    return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
            result: {
                content: [{ type: 'text', text: JSON.stringify(data) }],
            },
        }),
    } as Response)
}

const mockResolveResponse = (): Promise<Response> => Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ url: 'http://mock-mcp:7860/mcp', headers: {} }),
} as Response)

const installMcpFetchMock = (impl: () => Promise<Response>): ReturnType<typeof vi.spyOn<typeof global, 'fetch'>> => {
    return vi.spyOn(global, 'fetch').mockImplementation((input) => {
        const url = typeof input === 'string' ? input : (input as Request).url ?? String(input)
        if (url.includes('/v1/engine/mcp-gateways/')) {
            return mockResolveResponse()
        }
        if (url.includes('/v1/engine/interactive-flow-events')) {
            return Promise.resolve({ ok: true, status: 204, json: async () => null } as Response)
        }
        return impl()
    })
}

function countMcpCalls(spy: ReturnType<typeof vi.spyOn<typeof global, 'fetch'>>): number {
    return spy.mock.calls.filter(([input]) => {
        const url = typeof input === 'string' ? input : (input as Request).url ?? String(input)
        return !url.includes('/v1/engine/interactive-flow-events')
    }).length
}

function hasAnyMcpCall(spy: ReturnType<typeof vi.spyOn<typeof global, 'fetch'>>): boolean {
    return countMcpCalls(spy) > 0
}

const installMcpFetchSequence = (impls: Array<() => Promise<Response>>): ReturnType<typeof vi.spyOn<typeof global, 'fetch'>> => {
    let toolIdx = 0
    return vi.spyOn(global, 'fetch').mockImplementation((input) => {
        const url = typeof input === 'string' ? input : (input as Request).url ?? String(input)
        if (url.includes('/v1/engine/mcp-gateways/')) {
            return mockResolveResponse()
        }
        if (url.includes('/v1/engine/interactive-flow-events')) {
            return Promise.resolve({ ok: true, status: 204, json: async () => null } as Response)
        }
        const impl = impls[Math.min(toolIdx, impls.length - 1)]
        toolIdx++
        return impl()
    })
}

describe('interactive flow executor - dependency resolution', () => {

    it('should execute node with empty stateInputs immediately', async () => {
        const fetchSpy = installMcpFetchMock(() =>
            mockFetchResponse([{ code: 'UL', label: 'Limited usage' }]),
        )

        const action = buildInteractiveFlowAction({
            name: 'interactive_flow',
            nodes: [
                {
                    id: 'list_reasons',
                    name: 'list_reasons',
                    displayName: 'List Reasons',
                    nodeType: InteractiveFlowNodeType.TOOL,
                    stateInputs: [],
                    stateOutputs: ['closureReasons'],
                    tool: 'banking/list_closure_reasons',
                },
            ],
            mcpGatewayId: 'gw1234567890123456789A',
        })

        const result = await flowExecutor.execute({
            action,
            executionState: FlowExecutorContext.empty(),
            constants: generateMockEngineConstants(),
        })

        expect(result.verdict.status).toBe(FlowRunStatus.RUNNING)
        const output = result.getStepOutput('interactive_flow')
        expect(output?.status).toBe(StepOutputStatus.SUCCEEDED)
        expect((output?.output as Record<string, unknown>).executedNodeIds).toContain('list_reasons')
        fetchSpy.mockRestore()
    })

    it('should NOT execute tool node with unsatisfied stateInputs', async () => {
        const fetchSpy = installMcpFetchMock(() => mockFetchResponse({ data: 'result' }))

        const action = buildInteractiveFlowAction({
            name: 'interactive_flow',
            nodes: [
                {
                    id: 'collect_name',
                    name: 'collect_name',
                    displayName: 'Collect Name',
                    nodeType: InteractiveFlowNodeType.USER_INPUT,
                    stateInputs: [],
                    stateOutputs: ['clientName'],
                    render: { component: 'TextInput', props: {} },
                    message: 'Enter the client name',
                },
                {
                    id: 'search',
                    name: 'search_customer',
                    displayName: 'Search Customer',
                    nodeType: InteractiveFlowNodeType.TOOL,
                    stateInputs: ['clientName'],
                    stateOutputs: ['searchResults'],
                    tool: 'banking/search_customer',
                },
            ],
            mcpGatewayId: 'gw1234567890123456789A',
        })

        const result = await flowExecutor.execute({
            action,
            executionState: FlowExecutorContext.empty(),
            constants: generateMockEngineConstants(),
        })

        // Should pause at collect_name (first user_input with empty stateInputs)
        // search_customer should NOT have executed (clientName not in state)
        expect(result.verdict.status).toBe(FlowRunStatus.PAUSED)
        const output = result.getStepOutput('interactive_flow')
        const convOutput = output?.output as Record<string, unknown>
        expect(convOutput.executedNodeIds).toEqual([])
        expect(hasAnyMcpCall(fetchSpy)).toBe(false)
        fetchSpy.mockRestore()
    })

    it('should execute node after predecessor provides required stateOutput', async () => {
        const fetchSpy = installMcpFetchSequence([
            (): Promise<Response> => mockFetchResponse([{ ndg: '123', name: 'Test' }]),
            (): Promise<Response> => mockFetchResponse({ ndg: '123', fullName: 'Test User' }),
        ])

        const action = buildInteractiveFlowAction({
            name: 'interactive_flow',
            nodes: [
                {
                    id: 'search',
                    name: 'search_customer',
                    displayName: 'Search',
                    nodeType: InteractiveFlowNodeType.TOOL,
                    stateInputs: [],
                    stateOutputs: ['searchResults'],
                    tool: 'banking/search',
                },
                {
                    id: 'profile',
                    name: 'get_profile',
                    displayName: 'Get Profile',
                    nodeType: InteractiveFlowNodeType.TOOL,
                    stateInputs: ['searchResults'],
                    stateOutputs: ['customerProfile'],
                    tool: 'banking/get_profile',
                },
            ],
            mcpGatewayId: 'gw1234567890123456789A',
        })

        const result = await flowExecutor.execute({
            action,
            executionState: FlowExecutorContext.empty(),
            constants: generateMockEngineConstants(),
        })

        expect(result.verdict.status).toBe(FlowRunStatus.RUNNING)
        const output = result.getStepOutput('interactive_flow')
        const convOutput = output?.output as Record<string, unknown>
        expect(convOutput.executedNodeIds).toContain('search')
        expect(convOutput.executedNodeIds).toContain('profile')
        fetchSpy.mockRestore()
    })

    it('should execute multiple ready nodes in same resolution cycle', async () => {
        const fetchSpy = installMcpFetchMock(() => mockFetchResponse({ data: 'result' }))

        const action = buildInteractiveFlowAction({
            name: 'interactive_flow',
            nodes: [
                {
                    id: 'tool_a',
                    name: 'tool_a',
                    displayName: 'Tool A',
                    nodeType: InteractiveFlowNodeType.TOOL,
                    stateInputs: [],
                    stateOutputs: ['resultA'],
                    tool: 'mock/tool_a',
                },
                {
                    id: 'tool_b',
                    name: 'tool_b',
                    displayName: 'Tool B',
                    nodeType: InteractiveFlowNodeType.TOOL,
                    stateInputs: [],
                    stateOutputs: ['resultB'],
                    tool: 'mock/tool_b',
                },
            ],
            mcpGatewayId: 'gw1234567890123456789A',
        })

        const result = await flowExecutor.execute({
            action,
            executionState: FlowExecutorContext.empty(),
            constants: generateMockEngineConstants(),
        })

        expect(result.verdict.status).toBe(FlowRunStatus.RUNNING)
        const convOutput = result.getStepOutput('interactive_flow')?.output as Record<string, unknown>
        expect(convOutput.executedNodeIds).toContain('tool_a')
        expect(convOutput.executedNodeIds).toContain('tool_b')
        fetchSpy.mockRestore()
    })

    it('should execute node only once after resume (no duplicates)', async () => {
        const fetchSpy = installMcpFetchMock(() => mockFetchResponse({ data: 'result' }))

        const action = buildInteractiveFlowAction({
            name: 'interactive_flow',
            nodes: [
                {
                    id: 'tool_a',
                    name: 'tool_a',
                    displayName: 'Tool A',
                    nodeType: InteractiveFlowNodeType.TOOL,
                    stateInputs: [],
                    stateOutputs: ['resultA'],
                    tool: 'mock/tool_a',
                },
                {
                    id: 'user_input',
                    name: 'user_input',
                    displayName: 'User Input',
                    nodeType: InteractiveFlowNodeType.USER_INPUT,
                    stateInputs: ['resultA'],
                    stateOutputs: ['userValue'],
                    render: { component: 'TextInput', props: {} },
                },
            ],
            mcpGatewayId: 'gw1234567890123456789A',
        })

        // First execution: tool_a executes, then pauses at user_input
        const pauseResult = await flowExecutor.execute({
            action,
            executionState: FlowExecutorContext.empty(),
            constants: generateMockEngineConstants(),
        })
        expect(pauseResult.verdict.status).toBe(FlowRunStatus.PAUSED)

        // Resume with user data
        const resumeResult = await flowExecutor.execute({
            action,
            executionState: pauseResult.setCurrentPath(StepExecutionPath.empty()).setVerdict({ status: FlowRunStatus.RUNNING }),
            constants: generateMockEngineConstants({
                resumePayload: { body: { userValue: 'user-provided' }, headers: {}, queryParams: {} },
            }),
        })

        expect(resumeResult.verdict.status).toBe(FlowRunStatus.RUNNING)
        // tool_a should still be in executedNodeIds (not re-executed)
        // Total fetches: 1 resolve + 1 tool_a = 2
        expect(countMcpCalls(fetchSpy)).toBe(2)
        fetchSpy.mockRestore()
    })

    it('should handle diamond dependency: A→B, A→C, B+C→D', async () => {
        let callCount = 0
        const fetchSpy = installMcpFetchMock(() => {
            callCount++
            return mockFetchResponse({ value: `result_${callCount}` })
        })

        const action = buildInteractiveFlowAction({
            name: 'interactive_flow',
            nodes: [
                {
                    id: 'a',
                    name: 'node_a',
                    displayName: 'A',
                    nodeType: InteractiveFlowNodeType.TOOL,
                    stateInputs: [],
                    stateOutputs: ['resultA'],
                    tool: 'mock/a',
                },
                {
                    id: 'b',
                    name: 'node_b',
                    displayName: 'B',
                    nodeType: InteractiveFlowNodeType.TOOL,
                    stateInputs: ['resultA'],
                    stateOutputs: ['resultB'],
                    tool: 'mock/b',
                },
                {
                    id: 'c',
                    name: 'node_c',
                    displayName: 'C',
                    nodeType: InteractiveFlowNodeType.TOOL,
                    stateInputs: ['resultA'],
                    stateOutputs: ['resultC'],
                    tool: 'mock/c',
                },
                {
                    id: 'd',
                    name: 'node_d',
                    displayName: 'D',
                    nodeType: InteractiveFlowNodeType.TOOL,
                    stateInputs: ['resultB', 'resultC'],
                    stateOutputs: ['resultD'],
                    tool: 'mock/d',
                },
            ],
            mcpGatewayId: 'gw1234567890123456789A',
        })

        const result = await flowExecutor.execute({
            action,
            executionState: FlowExecutorContext.empty(),
            constants: generateMockEngineConstants(),
        })

        expect(result.verdict.status).toBe(FlowRunStatus.RUNNING)
        const convOutput = result.getStepOutput('interactive_flow')?.output as Record<string, unknown>
        const executedIds = convOutput.executedNodeIds as string[]
        expect(executedIds).toContain('a')
        expect(executedIds).toContain('b')
        expect(executedIds).toContain('c')
        expect(executedIds).toContain('d')
        expect(executedIds.indexOf('a')).toBeLessThan(executedIds.indexOf('b'))
        expect(executedIds.indexOf('a')).toBeLessThan(executedIds.indexOf('c'))
        expect(executedIds.indexOf('b')).toBeLessThan(executedIds.indexOf('d'))
        expect(executedIds.indexOf('c')).toBeLessThan(executedIds.indexOf('d'))
        fetchSpy.mockRestore()
    })

    it('should detect circular dependency and throw error', async () => {
        const action = buildInteractiveFlowAction({
            name: 'interactive_flow',
            nodes: [
                {
                    id: 'a',
                    name: 'node_a',
                    displayName: 'A',
                    nodeType: InteractiveFlowNodeType.TOOL,
                    stateInputs: ['resultB'],
                    stateOutputs: ['resultA'],
                    tool: 'mock/a',
                },
                {
                    id: 'b',
                    name: 'node_b',
                    displayName: 'B',
                    nodeType: InteractiveFlowNodeType.TOOL,
                    stateInputs: ['resultA'],
                    stateOutputs: ['resultB'],
                    tool: 'mock/b',
                },
            ],
            mcpGatewayId: 'gw1234567890123456789A',
        })

        await expect(flowExecutor.execute({
            action,
            executionState: FlowExecutorContext.empty(),
            constants: generateMockEngineConstants(),
        })).rejects.toThrow('Circular dependency')
    })
})

describe('interactive flow executor - skip behavior', () => {

    it('should skip user_input node when field is already in state', async () => {
        const fetchSpy = installMcpFetchMock(() => mockFetchResponse({ data: 'result' }))

        const action = buildInteractiveFlowAction({
            name: 'interactive_flow',
            nodes: [
                {
                    id: 'tool_a',
                    name: 'tool_a',
                    displayName: 'Tool A',
                    nodeType: InteractiveFlowNodeType.TOOL,
                    stateInputs: ['userValue'],
                    stateOutputs: ['toolResult'],
                    tool: 'mock/tool_a',
                },
                {
                    id: 'user_input',
                    name: 'user_input',
                    displayName: 'User Input',
                    nodeType: InteractiveFlowNodeType.USER_INPUT,
                    stateInputs: [],
                    stateOutputs: ['userValue'],
                    render: { component: 'TextInput', props: {} },
                },
            ],
            mcpGatewayId: 'gw1234567890123456789A',
        })

        // Provide userValue in resume payload, simulating field already available
        const result = await flowExecutor.execute({
            action,
            executionState: FlowExecutorContext.empty(),
            constants: generateMockEngineConstants({
                resumePayload: { body: { userValue: 'pre-provided' }, headers: {}, queryParams: {} },
            }),
        })

        // tool_a should execute because userValue was provided
        expect(result.verdict.status).toBe(FlowRunStatus.RUNNING)
        const convOutput = result.getStepOutput('interactive_flow')?.output as Record<string, unknown>
        expect(convOutput.executedNodeIds).toContain('tool_a')
        fetchSpy.mockRestore()
    })

    it('should complete without pause when all fields pre-populated', async () => {
        const fetchSpy = installMcpFetchMock(() => mockFetchResponse({ data: 'result' }))

        const action = buildInteractiveFlowAction({
            name: 'interactive_flow',
            nodes: [
                {
                    id: 'tool_a',
                    name: 'tool_a',
                    displayName: 'Tool A',
                    nodeType: InteractiveFlowNodeType.TOOL,
                    stateInputs: ['field1'],
                    stateOutputs: ['toolResult'],
                    tool: 'mock/tool_a',
                },
                {
                    id: 'confirm',
                    name: 'confirm',
                    displayName: 'Confirm',
                    nodeType: InteractiveFlowNodeType.CONFIRM,
                    stateInputs: ['toolResult'],
                    stateOutputs: ['confirmed'],
                    render: { component: 'ConfirmCard', props: {} },
                },
            ],
            mcpGatewayId: 'gw1234567890123456789A',
        })

        // Provide ALL fields (field1 + confirmed)
        const result = await flowExecutor.execute({
            action,
            executionState: FlowExecutorContext.empty(),
            constants: generateMockEngineConstants({
                resumePayload: { body: { field1: 'value', confirmed: true }, headers: {}, queryParams: {} },
            }),
        })

        expect(result.verdict.status).toBe(FlowRunStatus.RUNNING)
        expect(result.getStepOutput('interactive_flow')?.status).toBe(StepOutputStatus.SUCCEEDED)
        fetchSpy.mockRestore()
    })
})

describe('interactive flow executor - pause and resume', () => {

    it('should pause at first user_input with render hint when no state', async () => {
        const action = buildInteractiveFlowAction({
            name: 'interactive_flow',
            nodes: [
                {
                    id: 'user_name',
                    name: 'user_name',
                    displayName: 'Collect Name',
                    nodeType: InteractiveFlowNodeType.USER_INPUT,
                    stateInputs: [],
                    stateOutputs: ['clientName'],
                    render: { component: 'TextInput', props: { placeholder: 'Enter name' } },
                    message: 'What is the client name?',
                },
            ],
        })

        const result = await flowExecutor.execute({
            action,
            executionState: FlowExecutorContext.empty(),
            constants: generateMockEngineConstants(),
        })

        expect(result.verdict.status).toBe(FlowRunStatus.PAUSED)
        const output = result.getStepOutput('interactive_flow')
        expect(output?.status).toBe(StepOutputStatus.PAUSED)
    })

    it('should resume with user data, update state, and continue to next pause', async () => {
        const fetchSpy = installMcpFetchMock(() => mockFetchResponse([{ ndg: '123', name: 'Test' }]))

        const action = buildInteractiveFlowAction({
            name: 'interactive_flow',
            nodes: [
                {
                    id: 'collect_name',
                    name: 'collect_name',
                    displayName: 'Collect Name',
                    nodeType: InteractiveFlowNodeType.USER_INPUT,
                    stateInputs: [],
                    stateOutputs: ['clientName'],
                    render: { component: 'TextInput', props: {} },
                    message: 'What is the client name?',
                },
                {
                    id: 'search',
                    name: 'search_customer',
                    displayName: 'Search',
                    nodeType: InteractiveFlowNodeType.TOOL,
                    stateInputs: ['clientName'],
                    stateOutputs: ['searchResults'],
                    tool: 'banking/search',
                    toolParams: { name: 'clientName' },
                },
                {
                    id: 'select_customer',
                    name: 'select_customer',
                    displayName: 'Select',
                    nodeType: InteractiveFlowNodeType.USER_INPUT,
                    stateInputs: ['searchResults'],
                    stateOutputs: ['ndg'],
                    render: { component: 'DataTable', props: { selectable: true } },
                    message: 'Select a customer',
                },
            ],
            mcpGatewayId: 'gw1234567890123456789A',
        })

        // Turn 1: pauses at collect_name
        const pause1 = await flowExecutor.execute({
            action,
            executionState: FlowExecutorContext.empty(),
            constants: generateMockEngineConstants(),
        })
        expect(pause1.verdict.status).toBe(FlowRunStatus.PAUSED)

        // Turn 2: provide clientName → search executes → pauses at select_customer
        const pause2 = await flowExecutor.execute({
            action,
            executionState: pause1.setCurrentPath(StepExecutionPath.empty()).setVerdict({ status: FlowRunStatus.RUNNING }),
            constants: generateMockEngineConstants({
                resumePayload: { body: { clientName: 'Bellafronte' }, headers: {}, queryParams: {} },
            }),
        })
        expect(pause2.verdict.status).toBe(FlowRunStatus.PAUSED)
        const output2 = pause2.getStepOutput('interactive_flow')?.output as Record<string, unknown>
        expect((output2.executedNodeIds as string[])).toContain('search')
        expect((output2.state as Record<string, unknown>).clientName).toBe('Bellafronte')

        fetchSpy.mockRestore()
    })

    it('should handle three sequential turns (full interactive flow)', async () => {
        const fetchSpy = installMcpFetchMock(() => mockFetchResponse({ data: 'tool_result' }))

        const action = buildInteractiveFlowAction({
            name: 'interactive_flow',
            nodes: [
                {
                    id: 'input_1',
                    name: 'input_1',
                    displayName: 'Input 1',
                    nodeType: InteractiveFlowNodeType.USER_INPUT,
                    stateInputs: [],
                    stateOutputs: ['field1'],
                    render: { component: 'TextInput', props: {} },
                },
                {
                    id: 'tool_1',
                    name: 'tool_1',
                    displayName: 'Tool 1',
                    nodeType: InteractiveFlowNodeType.TOOL,
                    stateInputs: ['field1'],
                    stateOutputs: ['toolResult1'],
                    tool: 'mock/tool_1',
                },
                {
                    id: 'input_2',
                    name: 'input_2',
                    displayName: 'Input 2',
                    nodeType: InteractiveFlowNodeType.USER_INPUT,
                    stateInputs: ['toolResult1'],
                    stateOutputs: ['field2'],
                    render: { component: 'DataTable', props: { selectable: true } },
                },
                {
                    id: 'confirm',
                    name: 'confirm',
                    displayName: 'Confirm',
                    nodeType: InteractiveFlowNodeType.CONFIRM,
                    stateInputs: ['field2'],
                    stateOutputs: ['confirmed'],
                    render: { component: 'ConfirmCard', props: {} },
                },
            ],
            mcpGatewayId: 'gw1234567890123456789A',
        })

        // Turn 1: pauses at input_1
        const t1 = await flowExecutor.execute({
            action,
            executionState: FlowExecutorContext.empty(),
            constants: generateMockEngineConstants(),
        })
        expect(t1.verdict.status).toBe(FlowRunStatus.PAUSED)

        // Turn 2: provide field1 → tool executes → pauses at input_2
        const t2 = await flowExecutor.execute({
            action,
            executionState: t1.setCurrentPath(StepExecutionPath.empty()).setVerdict({ status: FlowRunStatus.RUNNING }),
            constants: generateMockEngineConstants({
                resumePayload: { body: { field1: 'value1' }, headers: {}, queryParams: {} },
            }),
        })
        expect(t2.verdict.status).toBe(FlowRunStatus.PAUSED)

        // Turn 3: provide field2 → pauses at confirm
        const t3 = await flowExecutor.execute({
            action,
            executionState: t2.setCurrentPath(StepExecutionPath.empty()).setVerdict({ status: FlowRunStatus.RUNNING }),
            constants: generateMockEngineConstants({
                resumePayload: { body: { field2: 'value2' }, headers: {}, queryParams: {} },
            }),
        })
        expect(t3.verdict.status).toBe(FlowRunStatus.PAUSED)

        // Turn 4: confirm → completes
        const t4 = await flowExecutor.execute({
            action,
            executionState: t3.setCurrentPath(StepExecutionPath.empty()).setVerdict({ status: FlowRunStatus.RUNNING }),
            constants: generateMockEngineConstants({
                resumePayload: { body: { confirmed: true }, headers: {}, queryParams: {} },
            }),
        })
        expect(t4.verdict.status).toBe(FlowRunStatus.RUNNING)
        expect(t4.getStepOutput('interactive_flow')?.status).toBe(StepOutputStatus.SUCCEEDED)

        fetchSpy.mockRestore()
    })

    it('should include render hint and message in pause metadata response', async () => {
        const action = buildInteractiveFlowAction({
            name: 'interactive_flow',
            nodes: [
                {
                    id: 'user_name',
                    name: 'user_name',
                    displayName: 'Collect Name',
                    nodeType: InteractiveFlowNodeType.USER_INPUT,
                    stateInputs: [],
                    stateOutputs: ['clientName'],
                    render: { component: 'TextInput', props: { placeholder: 'Enter name' } },
                    message: 'What is the client name?',
                },
            ],
        })

        const result = await flowExecutor.execute({
            action,
            executionState: FlowExecutorContext.empty(),
            constants: generateMockEngineConstants(),
        })

        expect(result.verdict.status).toBe(FlowRunStatus.PAUSED)
        const verdict = result.verdict as { status: FlowRunStatus.PAUSED, pauseMetadata: Record<string, unknown> }
        const response = verdict.pauseMetadata.response as Record<string, unknown>
        const body = response.body as Record<string, unknown>
        expect(body.message).toBe('What is the client name?')
        expect(body.render).toEqual({ component: 'TextInput', props: { placeholder: 'Enter name' } })
    })
})

describe('interactive flow executor - flow integration', () => {

    it('should continue to nextAction after interactive flow completes', async () => {
        const fetchSpy = installMcpFetchMock(() => mockFetchResponse({ data: 'result' }))

        const action = buildInteractiveFlowAction({
            name: 'interactive_flow',
            nodes: [
                {
                    id: 'tool_a',
                    name: 'tool_a',
                    displayName: 'Tool A',
                    nodeType: InteractiveFlowNodeType.TOOL,
                    stateInputs: [],
                    stateOutputs: ['resultA'],
                    tool: 'mock/tool_a',
                },
            ],
            mcpGatewayId: 'gw1234567890123456789A',
            nextAction: buildCodeAction({
                name: 'echo_step',
                input: {},
            }),
        })

        const result = await flowExecutor.execute({
            action,
            executionState: FlowExecutorContext.empty(),
            constants: generateMockEngineConstants(),
        })

        expect(result.verdict.status).toBe(FlowRunStatus.RUNNING)
        expect(result.getStepOutput('interactive_flow')?.status).toBe(StepOutputStatus.SUCCEEDED)
        // echo_step should have executed (nextAction)
        expect(result.getStepOutput('echo_step')).toBeDefined()
        fetchSpy.mockRestore()
    })
})

describe('interactive flow executor - error handling', () => {

    it('should handle tool execution failure', async () => {
        const fetchSpy = installMcpFetchMock(() =>
            Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) } as Response),
        )

        const action = buildInteractiveFlowAction({
            name: 'interactive_flow',
            nodes: [
                {
                    id: 'failing_tool',
                    name: 'failing_tool',
                    displayName: 'Failing Tool',
                    nodeType: InteractiveFlowNodeType.TOOL,
                    stateInputs: [],
                    stateOutputs: ['result'],
                    tool: 'mock/failing',
                },
            ],
            mcpGatewayId: 'gw1234567890123456789A',
        })

        const result = await flowExecutor.execute({
            action,
            executionState: FlowExecutorContext.empty(),
            constants: generateMockEngineConstants(),
        })

        expect(result.verdict.status).toBe(FlowRunStatus.FAILED)
        fetchSpy.mockRestore()
    })

    it('should handle resume with empty body without crash', async () => {
        const action = buildInteractiveFlowAction({
            name: 'interactive_flow',
            nodes: [
                {
                    id: 'user_input',
                    name: 'user_input',
                    displayName: 'Input',
                    nodeType: InteractiveFlowNodeType.USER_INPUT,
                    stateInputs: [],
                    stateOutputs: ['value'],
                    render: { component: 'TextInput', props: {} },
                },
            ],
        })

        // First pause
        const pause = await flowExecutor.execute({
            action,
            executionState: FlowExecutorContext.empty(),
            constants: generateMockEngineConstants(),
        })

        // Resume with empty body
        const resume = await flowExecutor.execute({
            action,
            executionState: pause.setCurrentPath(StepExecutionPath.empty()).setVerdict({ status: FlowRunStatus.RUNNING }),
            constants: generateMockEngineConstants({
                resumePayload: { body: {}, headers: {}, queryParams: {} },
            }),
        })

        // Should still be paused (empty body didn't provide 'value')
        expect(resume.verdict.status).toBe(FlowRunStatus.PAUSED)
    })

    it('should complete immediately with 0 nodes', async () => {
        const action = buildInteractiveFlowAction({
            name: 'interactive_flow',
            nodes: [],
            nextAction: buildCodeAction({
                name: 'echo_step',
                input: {},
            }),
        })

        const result = await flowExecutor.execute({
            action,
            executionState: FlowExecutorContext.empty(),
            constants: generateMockEngineConstants(),
        })

        expect(result.verdict.status).toBe(FlowRunStatus.RUNNING)
        expect(result.getStepOutput('interactive_flow')?.status).toBe(StepOutputStatus.SUCCEEDED)
    })
})

describe('interactive flow executor - GenericStepOutput', () => {

    it('should set output type to INTERACTIVE_FLOW', async () => {
        const action = buildInteractiveFlowAction({
            name: 'interactive_flow',
            nodes: [],
        })

        const result = await flowExecutor.execute({
            action,
            executionState: FlowExecutorContext.empty(),
            constants: generateMockEngineConstants(),
        })

        const output = result.getStepOutput('interactive_flow')
        expect(output?.type).toBe('INTERACTIVE_FLOW')
    })

    it('should include state and executedNodeIds in output', async () => {
        const fetchSpy = installMcpFetchMock(() => mockFetchResponse({ value: 42 }))

        const action = buildInteractiveFlowAction({
            name: 'interactive_flow',
            nodes: [
                {
                    id: 'tool_a',
                    name: 'tool_a',
                    displayName: 'Tool A',
                    nodeType: InteractiveFlowNodeType.TOOL,
                    stateInputs: [],
                    stateOutputs: ['result'],
                    tool: 'mock/tool_a',
                },
            ],
            mcpGatewayId: 'gw1234567890123456789A',
        })

        const result = await flowExecutor.execute({
            action,
            executionState: FlowExecutorContext.empty(),
            constants: generateMockEngineConstants(),
        })

        const convOutput = result.getStepOutput('interactive_flow')?.output as Record<string, unknown>
        expect(convOutput.state).toBeDefined()
        expect(convOutput.executedNodeIds).toEqual(['tool_a'])
        expect((convOutput.state as Record<string, unknown>).result).toBeDefined()
        fetchSpy.mockRestore()
    })

    it('should set PAUSED status correctly', async () => {
        const action = buildInteractiveFlowAction({
            name: 'interactive_flow',
            nodes: [
                {
                    id: 'input',
                    name: 'input',
                    displayName: 'Input',
                    nodeType: InteractiveFlowNodeType.USER_INPUT,
                    stateInputs: [],
                    stateOutputs: ['value'],
                    render: { component: 'TextInput', props: {} },
                },
            ],
        })

        const result = await flowExecutor.execute({
            action,
            executionState: FlowExecutorContext.empty(),
            constants: generateMockEngineConstants(),
        })

        expect(result.getStepOutput('interactive_flow')?.status).toBe(StepOutputStatus.PAUSED)
    })

    it('should set SUCCEEDED status on completion', async () => {
        const action = buildInteractiveFlowAction({
            name: 'interactive_flow',
            nodes: [],
        })

        const result = await flowExecutor.execute({
            action,
            executionState: FlowExecutorContext.empty(),
            constants: generateMockEngineConstants(),
        })

        expect(result.getStepOutput('interactive_flow')?.status).toBe(StepOutputStatus.SUCCEEDED)
    })

    it('should fail when a TOOL node runs without an mcpGatewayId configured', async () => {
        const action = buildInteractiveFlowAction({
            name: 'interactive_flow',
            nodes: [
                {
                    id: 'tool_a',
                    name: 'tool_a',
                    displayName: 'Tool A',
                    nodeType: InteractiveFlowNodeType.TOOL,
                    stateInputs: [],
                    stateOutputs: ['result'],
                    tool: 'mock/tool_a',
                },
            ],
        })

        const result = await flowExecutor.execute({
            action,
            executionState: FlowExecutorContext.empty(),
            constants: generateMockEngineConstants(),
        })

        expect(result.verdict.status).toBe(FlowRunStatus.FAILED)
        const output = result.getStepOutput('interactive_flow')
        expect(output?.status).toBe(StepOutputStatus.FAILED)
    })
})
