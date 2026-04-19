import { FlowRunStatus, InteractiveFlowNodeType, StepOutputStatus } from '@activepieces/shared'
import { FlowExecutorContext } from '../../src/lib/handler/context/flow-execution-context'
import { StepExecutionPath } from '../../src/lib/handler/context/step-execution-path'
import { flowExecutor } from '../../src/lib/handler/flow-executor'
import { buildCodeAction, buildInteractiveFlowAction, generateMockEngineConstants } from './test-helper'

const mockFetchResponse = (data: unknown) => {
    return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
            result: {
                content: [{ type: 'text', text: JSON.stringify(data) }],
            },
        }),
    } as Response)
}

const mockResolveResponse = () => Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ url: 'http://mock-mcp:7860/mcp', headers: {} }),
} as Response)

const installMcpFetchMock = (impl: () => Promise<Response>) => {
    return vi.spyOn(global, 'fetch').mockImplementation((input) => {
        const url = typeof input === 'string' ? input : (input as Request).url ?? String(input)
        if (url.includes('/v1/engine/mcp-gateways/')) {
            return mockResolveResponse()
        }
        return impl()
    })
}

describe('interactive flow - full lifecycle', () => {

    it('should execute complete flow: trigger → INTERACTIVE_FLOW(3 nodes) → code step', async () => {
        const fetchSpy = installMcpFetchMock(() => mockFetchResponse({ data: 'tool_result' }))

        const action = buildInteractiveFlowAction({
            name: 'interactive_flow',
            nodes: [
                {
                    id: 'collect_input',
                    name: 'collect_input',
                    displayName: 'Collect Input',
                    nodeType: InteractiveFlowNodeType.USER_INPUT,
                    stateInputs: [],
                    stateOutputs: ['userField'],
                    render: { component: 'TextInput', props: {} },
                    message: 'Enter a value',
                },
                {
                    id: 'process_tool',
                    name: 'process_tool',
                    displayName: 'Process',
                    nodeType: InteractiveFlowNodeType.TOOL,
                    stateInputs: ['userField'],
                    stateOutputs: ['processResult'],
                    tool: 'mock/process',
                },
                {
                    id: 'confirm_step',
                    name: 'confirm_step',
                    displayName: 'Confirm',
                    nodeType: InteractiveFlowNodeType.CONFIRM,
                    stateInputs: ['processResult'],
                    stateOutputs: ['confirmed'],
                    render: { component: 'ConfirmCard', props: {} },
                    message: 'Confirm the result?',
                },
            ],
            mcpGatewayId: 'gw1234567890123456789A',
            nextAction: buildCodeAction({
                name: 'echo_step',
                input: {},
            }),
        })

        // Turn 1: pause at collect_input
        const t1 = await flowExecutor.execute({
            action,
            executionState: FlowExecutorContext.empty(),
            constants: generateMockEngineConstants(),
        })
        expect(t1.verdict.status).toBe(FlowRunStatus.PAUSED)

        // Turn 2: provide userField → tool executes → pause at confirm
        const t2 = await flowExecutor.execute({
            action,
            executionState: t1.setCurrentPath(StepExecutionPath.empty()).setVerdict({ status: FlowRunStatus.RUNNING }),
            constants: generateMockEngineConstants({
                resumePayload: { body: { userField: 'test_value' }, headers: {}, queryParams: {} },
            }),
        })
        expect(t2.verdict.status).toBe(FlowRunStatus.PAUSED)
        const output2 = t2.getStepOutput('interactive_flow')?.output as Record<string, unknown>
        expect((output2.executedNodeIds as string[])).toContain('process_tool')

        // Turn 3: confirm → INTERACTIVE_FLOW completes → code step executes
        const t3 = await flowExecutor.execute({
            action,
            executionState: t2.setCurrentPath(StepExecutionPath.empty()).setVerdict({ status: FlowRunStatus.RUNNING }),
            constants: generateMockEngineConstants({
                resumePayload: { body: { confirmed: true }, headers: {}, queryParams: {} },
            }),
        })
        expect(t3.verdict.status).toBe(FlowRunStatus.RUNNING)
        expect(t3.getStepOutput('interactive_flow')?.status).toBe(StepOutputStatus.SUCCEEDED)
        expect(t3.getStepOutput('echo_step')).toBeDefined()

        // Verify final state contains all collected fields
        const finalOutput = t3.getStepOutput('interactive_flow')?.output as Record<string, unknown>
        const state = finalOutput.state as Record<string, unknown>
        expect(state.userField).toBe('test_value')
        expect(state.processResult).toBeDefined()
        expect(state.confirmed).toBe(true)

        fetchSpy.mockRestore()
    })
})

describe('interactive flow - dependency skip', () => {

    it('should skip user_input when field is pre-populated and execute downstream directly', async () => {
        const fetchSpy = installMcpFetchMock(() => mockFetchResponse({ processed: true }))

        const action = buildInteractiveFlowAction({
            name: 'interactive_flow',
            nodes: [
                {
                    id: 'collect_input',
                    name: 'collect_input',
                    displayName: 'Collect',
                    nodeType: InteractiveFlowNodeType.USER_INPUT,
                    stateInputs: [],
                    stateOutputs: ['field1'],
                    render: { component: 'TextInput', props: {} },
                },
                {
                    id: 'tool_a',
                    name: 'tool_a',
                    displayName: 'Tool A',
                    nodeType: InteractiveFlowNodeType.TOOL,
                    stateInputs: ['field1'],
                    stateOutputs: ['toolResult'],
                    tool: 'mock/tool_a',
                },
            ],
            mcpGatewayId: 'gw1234567890123456789A',
        })

        // Provide field1 upfront → user_input skipped, tool executes directly
        const result = await flowExecutor.execute({
            action,
            executionState: FlowExecutorContext.empty(),
            constants: generateMockEngineConstants({
                resumePayload: { body: { field1: 'pre-provided' }, headers: {}, queryParams: {} },
            }),
        })

        expect(result.verdict.status).toBe(FlowRunStatus.RUNNING)
        expect(result.getStepOutput('interactive_flow')?.status).toBe(StepOutputStatus.SUCCEEDED)
        const output = result.getStepOutput('interactive_flow')?.output as Record<string, unknown>
        expect((output.executedNodeIds as string[])).toContain('tool_a')
        // 1 gateway resolve + 1 tool call
        expect(fetchSpy).toHaveBeenCalledTimes(2)

        fetchSpy.mockRestore()
    })
})

describe('interactive flow - edge cases', () => {

    it('should complete immediately with 0 nodes and execute nextAction', async () => {
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
        expect(result.getStepOutput('echo_step')).toBeDefined()
    })

    it('should handle resume with empty body without crash', async () => {
        const action = buildInteractiveFlowAction({
            name: 'interactive_flow',
            nodes: [
                {
                    id: 'input',
                    name: 'user_input',
                    displayName: 'Input',
                    nodeType: InteractiveFlowNodeType.USER_INPUT,
                    stateInputs: [],
                    stateOutputs: ['value'],
                    render: { component: 'TextInput', props: {} },
                },
            ],
        })

        const pause = await flowExecutor.execute({
            action,
            executionState: FlowExecutorContext.empty(),
            constants: generateMockEngineConstants(),
        })

        const resume = await flowExecutor.execute({
            action,
            executionState: pause.setCurrentPath(StepExecutionPath.empty()).setVerdict({ status: FlowRunStatus.RUNNING }),
            constants: generateMockEngineConstants({
                resumePayload: { body: {}, headers: {}, queryParams: {} },
            }),
        })

        expect(resume.verdict.status).toBe(FlowRunStatus.PAUSED)
    })

    it('should handle tool failure with FAILED verdict and preserved state', async () => {
        const fetchSpy = installMcpFetchMock(() =>
            Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) } as Response),
        )

        const action = buildInteractiveFlowAction({
            name: 'interactive_flow',
            nodes: [
                {
                    id: 'failing_tool',
                    name: 'failing_tool',
                    displayName: 'Failing',
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
})
