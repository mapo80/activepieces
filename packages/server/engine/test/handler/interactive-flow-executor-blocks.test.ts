import { BlocksV1Payload, InteractiveFlowNodeType, StepOutputStatus } from '@activepieces/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FlowExecutorContext } from '../../src/lib/handler/context/flow-execution-context'
import { flowExecutor } from '../../src/lib/handler/flow-executor'
import { workerSocket } from '../../src/lib/worker-socket'
import { buildInteractiveFlowAction, generateMockEngineConstants } from './test-helper'

type SendFlowResponseCall = {
    workerHandlerId: string
    httpRequestId: string
    runResponse: { status: number, body: unknown, headers: Record<string, string> }
}

function installSyncCaller(): ReturnType<typeof vi.fn> {
    const sendFlowResponse = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(workerSocket, 'getWorkerClient').mockReturnValue({
        sendFlowResponse,
        updateRunProgress: vi.fn(),
        uploadRunLog: vi.fn(),
        updateStepProgress: vi.fn(),
    } as never)
    return sendFlowResponse
}

function installFetchMock({ extractorReturns, questionText }: {
    extractorReturns: Record<string, unknown>
    questionText: string
}): void {
    vi.spyOn(global, 'fetch').mockImplementation(async (input: unknown) => {
        const url = typeof input === 'string' ? input : String((input as { url?: string }).url ?? input)
        if (url.includes('/v1/engine/interactive-flow-ai/question-generate')) {
            return { ok: true, status: 200, json: async () => ({ text: questionText, tokensUsed: 5 }) } as unknown as Response
        }
        if (url.includes('/v1/engine/interactive-flow-ai/field-extract')) {
            return { ok: true, status: 200, json: async () => ({ extractedFields: extractorReturns, tokensUsed: 5 }) } as unknown as Response
        }
        if (url.includes('/v1/engine/interactive-flow-events')) {
            return { ok: true, status: 204, json: async () => null } as unknown as Response
        }
        if (url.includes('/v1/engine/mcp-gateways/')) {
            return { ok: true, status: 200, json: async () => ({ url: 'http://mock-mcp/mcp', headers: {} }) } as unknown as Response
        }
        if (url.includes('/v1/store-entries')) {
            return { ok: true, status: 404, json: async () => null, text: async () => '' } as unknown as Response
        }
        return { ok: true, status: 200, json: async () => ({}) } as unknown as Response
    })
}

const EXECUTOR_CONSTANTS_SYNC = {
    workerHandlerId: 'test-worker-handler',
    httpRequestId: 'test-http-request',
    flowVersionId: 'flowVersion-v1',
}

function buildPickNdgFlow(): ReturnType<typeof buildInteractiveFlowAction> {
    const action = buildInteractiveFlowAction({
        name: 'interactive_flow',
        nodes: [
            {
                id: 'pick_ndg',
                name: 'pick_ndg',
                displayName: 'Pick NDG',
                nodeType: InteractiveFlowNodeType.USER_INPUT,
                stateInputs: ['customerMatches'],
                stateOutputs: ['ndg'],
                render: {
                    component: 'DataTable',
                    props: {
                        sourceField: 'customerMatches',
                        columns: [
                            { key: 'ndg', header: 'NDG' },
                            { key: 'denominazione', header: 'Denominazione' },
                            { key: 'tipologia', header: 'Tipologia' },
                        ],
                    },
                },
                message: { dynamic: true },
            },
        ],
        stateFields: [
            { name: 'customerMatches', type: 'array', extractable: false },
            { name: 'ndg', type: 'string', extractable: true },
        ],
        mcpGatewayId: 'gw1234567890123456789A',
        fieldExtractor: { aiProviderId: 'openai', model: 'gpt-4o-mini' },
        questionGenerator: { aiProviderId: 'openai', model: 'gpt-4o' },
    })
    action.settings.sessionIdInput = '{{trigger.sessionId}}'
    action.settings.messageInput = '{{trigger.message}}'
    return action
}

describe('interactive-flow executor — blocks-v1 emit for pick_from_list', () => {
    beforeEach(() => { vi.restoreAllMocks() })
    afterEach(() => { vi.restoreAllMocks() })

    it('emits blocks-v1 with data-list when pausing on pick_ndg with customerMatches in state', async () => {
        const sendSpy = installSyncCaller()
        const matches = [
            { ndg: '11255521', denominazione: 'BELLAFRONTE GIANLUCA', tipologia: 'PRIVATO' },
            { ndg: '22334455', denominazione: 'ROSSI MARIO', tipologia: 'PRIVATO' },
        ]
        installFetchMock({
            extractorReturns: { customerMatches: matches },
            questionText: 'Ho trovato 2 clienti.',
        })

        const action = buildPickNdgFlow()
        const executionState = FlowExecutorContext.empty().upsertStep('trigger', {
            type: 'PIECE_TRIGGER' as never,
            status: StepOutputStatus.SUCCEEDED,
            input: {},
            output: { sessionId: 'sid-blocks', message: 'cerca' },
        } as never)

        await flowExecutor.execute({
            action,
            executionState,
            constants: generateMockEngineConstants(EXECUTOR_CONSTANTS_SYNC),
        })

        expect(sendSpy).toHaveBeenCalled()
        const call = sendSpy.mock.calls[0][0] as SendFlowResponseCall
        const body = call.runResponse.body as BlocksV1Payload
        expect(body.type).toBe('blocks-v1')
        expect(body.blocks).toHaveLength(2)
        expect(body.blocks[0]).toEqual({ type: 'text', value: 'Ho trovato 2 clienti.' })
        expect(body.blocks[1].type).toBe('data-list')
        const dataList = body.blocks[1] as Extract<typeof body.blocks[number], { type: 'data-list' }>
        expect(dataList.items).toHaveLength(2)
        expect(dataList.items[0]).toMatchObject({
            primary: '11255521',
            title: 'BELLAFRONTE GIANLUCA',
            subtitle: 'PRIVATO',
            payload: '11255521',
        })
        expect(dataList.items[1]).toMatchObject({
            primary: '22334455',
            title: 'ROSSI MARIO',
            payload: '22334455',
        })
    })

    it('falls back to markdown payload when pendingInteraction is open_text (no pick_from_list)', async () => {
        const sendSpy = installSyncCaller()
        installFetchMock({
            extractorReturns: {},
            questionText: 'Qual è il nome del cliente?',
        })

        const action = buildInteractiveFlowAction({
            name: 'interactive_flow',
            nodes: [
                {
                    id: 'ask_name',
                    name: 'ask_name',
                    displayName: 'Ask name',
                    nodeType: InteractiveFlowNodeType.USER_INPUT,
                    stateInputs: [],
                    stateOutputs: ['customerName'],
                    render: { component: 'TextInput', props: {} },
                    message: { dynamic: true },
                },
            ],
            stateFields: [{ name: 'customerName', type: 'string', extractable: true }],
            mcpGatewayId: 'gw1234567890123456789A',
            fieldExtractor: { aiProviderId: 'openai', model: 'gpt-4o-mini' },
            questionGenerator: { aiProviderId: 'openai', model: 'gpt-4o' },
        })
        action.settings.sessionIdInput = '{{trigger.sessionId}}'
        action.settings.messageInput = '{{trigger.message}}'

        const executionState = FlowExecutorContext.empty().upsertStep('trigger', {
            type: 'PIECE_TRIGGER' as never,
            status: StepOutputStatus.SUCCEEDED,
            input: {},
            output: { sessionId: 'sid-md', message: 'ciao' },
        } as never)

        await flowExecutor.execute({
            action,
            executionState,
            constants: generateMockEngineConstants(EXECUTOR_CONSTANTS_SYNC),
        })

        const call = sendSpy.mock.calls[0][0] as SendFlowResponseCall
        const body = call.runResponse.body as { type: string, value: string }
        expect(body.type).toBe('markdown')
        expect(body.value).toBe('Qual è il nome del cliente?')
    })
})
