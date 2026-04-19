import { FlowRunStatus, InteractiveFlowNodeType, StepOutputStatus } from '@activepieces/shared'
import { describe, expect, it, vi } from 'vitest'
import { FlowExecutorContext } from '../../src/lib/handler/context/flow-execution-context'
import { StepExecutionPath } from '../../src/lib/handler/context/step-execution-path'
import { flowExecutor } from '../../src/lib/handler/flow-executor'
import { buildInteractiveFlowAction, generateMockEngineConstants } from './test-helper'

function mockResolveGateway(): Response {
    return {
        ok: true,
        status: 200,
        json: async () => ({ url: 'http://mock-mcp/mcp', headers: {} }),
    } as unknown as Response
}

function mockToolCall(data: unknown): Response {
    return {
        ok: true,
        status: 200,
        json: async () => ({ result: { content: [{ type: 'text', text: JSON.stringify(data) }] } }),
    } as unknown as Response
}

function mockJson(data: unknown): Response {
    return {
        ok: true,
        status: 200,
        json: async () => data,
    } as unknown as Response
}

describe('interactive flow executor - LLM integration (field extractor)', () => {

    it('calls field-extract on resume when a user message is present and merges extracted fields into state', async () => {
        const extractorSpy = vi.fn()
        vi.spyOn(global, 'fetch').mockImplementation((input) => {
            const url = typeof input === 'string' ? input : (input as Request).url ?? String(input)
            if (url.includes('/v1/engine/mcp-gateways/')) return Promise.resolve(mockResolveGateway())
            if (url.includes('/v1/engine/interactive-flow-ai/field-extract')) {
                extractorSpy(url)
                return Promise.resolve(mockJson({ extractedFields: { ndg: '42', clientName: 'Polito' }, tokensUsed: 100 }))
            }
            return Promise.resolve(mockToolCall({ accountBalance: 1000 }))
        })

        const action = buildInteractiveFlowAction({
            name: 'interactive_flow',
            nodes: [
                {
                    id: 'ask_details',
                    name: 'ask_details',
                    displayName: 'Ask',
                    nodeType: InteractiveFlowNodeType.USER_INPUT,
                    stateInputs: [],
                    stateOutputs: ['ndg', 'clientName'],
                    render: { component: 'TextInput', props: {} },
                    message: 'please tell me',
                },
                {
                    id: 'fetch_balance',
                    name: 'fetch_balance',
                    displayName: 'Fetch',
                    nodeType: InteractiveFlowNodeType.TOOL,
                    stateInputs: ['ndg'],
                    stateOutputs: ['accountBalance'],
                    tool: 'mock/fetch_balance',
                },
            ],
            stateFields: [
                { name: 'ndg', type: 'string', extractable: true },
                { name: 'clientName', type: 'string', extractable: true },
                { name: 'accountBalance', type: 'number' },
            ],
            mcpGatewayId: 'gw1234567890123456789A',
            fieldExtractor: { aiProviderId: 'openai', model: 'gpt-4o-mini' },
            systemPrompt: 'banking agent',
        })

        // Turn 1: initial pause at ask_details
        const t1 = await flowExecutor.execute({
            action,
            executionState: FlowExecutorContext.empty(),
            constants: generateMockEngineConstants(),
        })
        expect(t1.verdict.status).toBe(FlowRunStatus.PAUSED)

        // Turn 2: user replies with free-text message → extractor fills ndg + clientName, tool runs, flow completes
        const t2 = await flowExecutor.execute({
            action,
            executionState: t1.setCurrentPath(StepExecutionPath.empty()).setVerdict({ status: FlowRunStatus.RUNNING }),
            constants: generateMockEngineConstants({
                resumePayload: { body: { message: 'estingui rapporto di Polito ndg 42' }, headers: {}, queryParams: {} },
            }),
        })

        expect(extractorSpy).toHaveBeenCalledTimes(1)
        expect(t2.getStepOutput('interactive_flow')?.status).toBe(StepOutputStatus.SUCCEEDED)
        const output = t2.getStepOutput('interactive_flow')?.output as Record<string, unknown>
        expect(output.state).toMatchObject({ ndg: '42', clientName: 'Polito', accountBalance: 1000 })
    })

    it('does not call extractor when no user message is present in resumePayload', async () => {
        const extractorSpy = vi.fn()
        vi.spyOn(global, 'fetch').mockImplementation((input) => {
            const url = typeof input === 'string' ? input : (input as Request).url ?? String(input)
            if (url.includes('/interactive-flow-ai/field-extract')) {
                extractorSpy(url)
                return Promise.resolve(mockJson({ extractedFields: {} }))
            }
            return Promise.resolve(mockResolveGateway())
        })

        const action = buildInteractiveFlowAction({
            name: 'interactive_flow',
            nodes: [{
                id: 'ask',
                name: 'ask',
                displayName: 'Ask',
                nodeType: InteractiveFlowNodeType.USER_INPUT,
                stateInputs: [],
                stateOutputs: ['answer'],
                render: { component: 'TextInput', props: {} },
                message: 'ask',
            }],
            stateFields: [{ name: 'answer', type: 'string', extractable: true }],
            fieldExtractor: { aiProviderId: 'openai', model: 'gpt-4o' },
        })

        await flowExecutor.execute({
            action,
            executionState: FlowExecutorContext.empty(),
            constants: generateMockEngineConstants({
                resumePayload: { body: { answer: 'direct' }, headers: {}, queryParams: {} },
            }),
        })
        expect(extractorSpy).not.toHaveBeenCalled()
    })
})

describe('interactive flow executor - LLM integration (question generator)', () => {

    it('generates a dynamic pause message when node.message.dynamic and generator configured', async () => {
        const genSpy = vi.fn()
        vi.spyOn(global, 'fetch').mockImplementation((input) => {
            const url = typeof input === 'string' ? input : (input as Request).url ?? String(input)
            if (url.includes('/interactive-flow-ai/question-generate')) {
                genSpy(url)
                return Promise.resolve(mockJson({ text: 'Qual è il NDG del cliente?', tokensUsed: 40 }))
            }
            return Promise.resolve(mockResolveGateway())
        })

        const action = buildInteractiveFlowAction({
            name: 'interactive_flow',
            nodes: [{
                id: 'ask_ndg',
                name: 'ask_ndg',
                displayName: 'Ask NDG',
                nodeType: InteractiveFlowNodeType.USER_INPUT,
                stateInputs: [],
                stateOutputs: ['ndg'],
                render: { component: 'TextInput', props: {} },
                message: { dynamic: true },
            }],
            stateFields: [{ name: 'ndg', type: 'string', label: { it: 'NDG', en: 'NDG' } }],
            questionGenerator: { aiProviderId: 'openai', model: 'gpt-4o', styleTemplate: 'banking_formal_it' },
            locale: 'it',
        })

        const result = await flowExecutor.execute({
            action,
            executionState: FlowExecutorContext.empty(),
            constants: generateMockEngineConstants(),
        })

        expect(result.verdict.status).toBe(FlowRunStatus.PAUSED)
        const verdict = result.verdict as { status: FlowRunStatus.PAUSED, pauseMetadata: Record<string, unknown> }
        const body = (verdict.pauseMetadata.response as { body: Record<string, unknown> }).body
        expect(body.message).toBe('Qual è il NDG del cliente?')
        expect(genSpy).toHaveBeenCalledTimes(1)
    })

    it('falls back to static fallback text when generator returns empty', async () => {
        vi.spyOn(global, 'fetch').mockImplementation((input) => {
            const url = typeof input === 'string' ? input : (input as Request).url ?? String(input)
            if (url.includes('/interactive-flow-ai/question-generate')) {
                return Promise.resolve(mockJson({ text: '  ', tokensUsed: 0 }))
            }
            return Promise.resolve(mockResolveGateway())
        })

        const action = buildInteractiveFlowAction({
            name: 'interactive_flow',
            nodes: [{
                id: 'ask_ndg',
                name: 'ask_ndg',
                displayName: 'Ask NDG',
                nodeType: InteractiveFlowNodeType.USER_INPUT,
                stateInputs: [],
                stateOutputs: ['ndg'],
                render: { component: 'TextInput', props: {} },
                message: { dynamic: true, fallback: { en: 'What is the NDG?', it: 'Qual è il NDG?' } },
            }],
            stateFields: [{ name: 'ndg', type: 'string' }],
            questionGenerator: { aiProviderId: 'openai', model: 'gpt-4o' },
            locale: 'en',
        })

        const result = await flowExecutor.execute({
            action,
            executionState: FlowExecutorContext.empty(),
            constants: generateMockEngineConstants(),
        })
        const verdict = result.verdict as { status: FlowRunStatus.PAUSED, pauseMetadata: Record<string, unknown> }
        const body = (verdict.pauseMetadata.response as { body: Record<string, unknown> }).body
        expect(body.message).toBe('What is the NDG?')
    })
})
