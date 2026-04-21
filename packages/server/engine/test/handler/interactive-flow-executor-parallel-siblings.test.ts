import { InteractiveFlowNodeType, StepOutputStatus } from '@activepieces/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FlowExecutorContext } from '../../src/lib/handler/context/flow-execution-context'
import { flowExecutor } from '../../src/lib/handler/flow-executor'
import { SessionRecord } from '../../src/lib/handler/session-store'
import { workerSocket } from '../../src/lib/worker-socket'
import { buildInteractiveFlowAction, generateMockEngineConstants } from './test-helper'

type StoreMock = {
    records: Map<string, SessionRecord>
    putCalls: Array<{ key: string, value: SessionRecord }>
    extractorCalls: Array<Record<string, unknown>>
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

function installStoreAndFetchMock({ extractorReturns, questionText }: {
    extractorReturns?: Record<string, unknown>
    questionText?: string
}): StoreMock {
    const mock: StoreMock = {
        records: new Map(),
        putCalls: [],
        extractorCalls: [],
    }
    vi.spyOn(global, 'fetch').mockImplementation(async (input: unknown, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : String((input as { url?: string }).url ?? input)
        if (url.includes('/v1/engine/interactive-flow-ai/question-generate')) {
            return { ok: true, status: 200, json: async () => ({ text: questionText ?? 'select', tokensUsed: 5 }) } as unknown as Response
        }
        if (url.includes('/v1/engine/interactive-flow-ai/field-extract')) {
            const body = JSON.parse(String(init?.body ?? '{}'))
            mock.extractorCalls.push(body)
            return { ok: true, status: 200, json: async () => ({ extractedFields: extractorReturns ?? {}, tokensUsed: 5 }) } as unknown as Response
        }
        if (url.includes('/v1/engine/interactive-flow-events')) {
            return { ok: true, status: 204, json: async () => null } as unknown as Response
        }
        if (url.includes('/v1/engine/mcp-gateways/')) {
            return { ok: true, status: 200, json: async () => ({ url: 'http://mock-mcp/mcp', headers: {} }) } as unknown as Response
        }
        if (url.includes('/v1/store-entries')) {
            const method = init?.method ?? 'GET'
            const parsed = new URL(url)
            const key = parsed.searchParams.get('key') ?? ''
            if (method === 'GET') {
                if (!mock.records.has(key)) {
                    return { ok: false, status: 404, json: async () => null, text: async () => '' } as unknown as Response
                }
                return { ok: true, status: 200, json: async () => ({ value: mock.records.get(key) }) } as unknown as Response
            }
            if (method === 'POST') {
                const body = JSON.parse(String(init?.body))
                mock.putCalls.push({ key: body.key, value: body.value })
                mock.records.set(body.key, body.value)
                return { ok: true, status: 200, json: async () => ({}) } as unknown as Response
            }
            if (method === 'DELETE') {
                mock.records.delete(key)
                return { ok: true, status: 204, json: async () => null } as unknown as Response
            }
        }
        return { ok: true, status: 200, json: async () => ({}) } as unknown as Response
    })
    return mock
}

const EXECUTOR_CONSTANTS_SYNC = {
    workerHandlerId: 'test-worker-handler',
    httpRequestId: 'test-http-request',
    flowVersionId: 'flowVersion-v1',
}

function buildSiblingsAction(): ReturnType<typeof buildInteractiveFlowAction> {
    const action = buildInteractiveFlowAction({
        name: 'interactive_flow',
        nodes: [
            {
                id: 'collect_reason',
                name: 'collect_reason',
                displayName: 'Motivazione',
                nodeType: InteractiveFlowNodeType.USER_INPUT,
                stateInputs: ['closureReasons'],
                stateOutputs: ['closureReasonCode'],
                allowedExtraFields: ['closureDate'],
                render: {
                    component: 'DataTable',
                    props: {
                        layout: 'table',
                        sourceField: 'closureReasons',
                        columns: [
                            { key: 'code', header: 'Codice' },
                            { key: 'label', header: 'Motivazione' },
                        ],
                    },
                },
                message: { dynamic: true },
            },
            {
                id: 'collect_date',
                name: 'collect_date',
                displayName: 'Data',
                nodeType: InteractiveFlowNodeType.USER_INPUT,
                stateInputs: ['closureReasons'],
                stateOutputs: ['closureDate'],
                allowedExtraFields: ['closureReasonCode'],
                render: { component: 'DatePickerCard', props: { format: 'YYYY-MM-DD' } },
                message: { dynamic: true },
            },
            {
                id: 'generate_pdf',
                name: 'generate_pdf',
                displayName: 'Genera PDF',
                nodeType: InteractiveFlowNodeType.TOOL,
                stateInputs: ['closureReasonCode', 'closureDate'],
                stateOutputs: ['moduleBase64'],
                tool: 'banking/generate_module',
            },
        ],
        stateFields: [
            { name: 'closureReasons', type: 'array', extractable: false },
            { name: 'closureReasonCode', type: 'string', extractable: true,
                enumFrom: 'closureReasons', enumValueField: 'code' },
            { name: 'closureDate', type: 'string', extractable: true, parser: 'absolute-date', format: 'date' },
            { name: 'moduleBase64', type: 'string', extractable: false },
        ],
        mcpGatewayId: 'gw1234567890123456789A',
        fieldExtractor: { aiProviderId: 'openai', model: 'gpt-4o-mini' },
        questionGenerator: { aiProviderId: 'openai', model: 'gpt-4o' },
    })
    action.settings.sessionIdInput = '{{trigger.sessionId}}'
    action.settings.messageInput = '{{trigger.message}}'
    return action
}

const REASONS = [
    { code: '01', label: 'Trasferimento estero' },
    { code: '02', label: 'Scomodità' },
]

describe('interactive-flow executor — parallel USER_INPUT siblings', () => {
    beforeEach(() => { vi.restoreAllMocks() })
    afterEach(() => { vi.restoreAllMocks() })

    it('pauses on first sibling (collect_reason) when both share stateInputs and neither is resolved', async () => {
        const sendSpy = installSyncCaller()
        const store = installStoreAndFetchMock({
            extractorReturns: {},
            questionText: 'Scegli la motivazione',
        })
        const priorKey = 'projectId/flow_flowId/ifsession:interactive_flow:sid-siblings-a'
        store.records.set(priorKey, {
            state: { closureReasons: REASONS },
            history: [],
            flowVersionId: 'flowVersion-v1',
            lastTurnAt: new Date().toISOString(),
        })

        const action = buildSiblingsAction()
        const executionState = FlowExecutorContext.empty().upsertStep('trigger', {
            type: 'PIECE_TRIGGER' as never,
            status: StepOutputStatus.SUCCEEDED,
            input: {},
            output: { sessionId: 'sid-siblings-a', message: '' },
        } as never)

        const result = await flowExecutor.execute({
            action,
            executionState,
            constants: generateMockEngineConstants(EXECUTOR_CONSTANTS_SYNC),
        })

        expect(result.getStepOutput('interactive_flow')?.status).toBe(StepOutputStatus.PAUSED)
        const lastPut = store.putCalls[store.putCalls.length - 1]
        expect(lastPut.value.pendingInteraction?.nodeId).toBe('collect_reason')
        expect(lastPut.value.pendingInteraction?.type).toBe('pick_from_list')
        expect(sendSpy).toHaveBeenCalled()
    })

    it('power-user path: extractor returns both fields via allowedExtraFields → both siblings resolve in one turn', async () => {
        installSyncCaller()
        const store = installStoreAndFetchMock({
            extractorReturns: { closureReasonCode: '02', closureDate: '2029-04-15' },
            questionText: 'irrelevant',
        })
        const priorKey = 'projectId/flow_flowId/ifsession:interactive_flow:sid-siblings-b'
        store.records.set(priorKey, {
            state: { closureReasons: REASONS },
            history: [{ role: 'assistant', text: 'Seleziona motivazione' }],
            flowVersionId: 'flowVersion-v1',
            lastTurnAt: new Date().toISOString(),
            pendingInteraction: {
                type: 'pick_from_list',
                field: 'closureReasonCode',
                options: [
                    { ordinal: 1, label: 'Trasferimento estero', value: '01' },
                    { ordinal: 2, label: 'Scomodità', value: '02' },
                ],
                nodeId: 'collect_reason',
            },
        })

        const action = buildSiblingsAction()
        const executionState = FlowExecutorContext.empty().upsertStep('trigger', {
            type: 'PIECE_TRIGGER' as never,
            status: StepOutputStatus.SUCCEEDED,
            input: {},
            output: { sessionId: 'sid-siblings-b', message: 'motivazione 02 data 2029-04-15' },
        } as never)

        await flowExecutor.execute({
            action,
            executionState,
            constants: generateMockEngineConstants(EXECUTOR_CONSTANTS_SYNC),
        })

        // The extractor MUST have been invoked with the active node's allowedExtraFields
        // so it can legitimately extract closureDate while paused on collect_reason.
        expect(store.extractorCalls.length).toBeGreaterThan(0)
        const call = store.extractorCalls[0] as { currentNode?: { nodeId?: string, stateOutputs?: string[], allowedExtraFields?: string[] } }
        expect(call.currentNode?.nodeId).toBe('collect_reason')
        expect(call.currentNode?.stateOutputs).toEqual(['closureReasonCode'])
        expect(call.currentNode?.allowedExtraFields).toEqual(['closureDate'])
    })

    it('pauses on second sibling (collect_date) when first is resolved but second is not', async () => {
        installSyncCaller()
        const store = installStoreAndFetchMock({
            extractorReturns: {},
            questionText: 'Indica la data',
        })
        const priorKey = 'projectId/flow_flowId/ifsession:interactive_flow:sid-siblings-c'
        store.records.set(priorKey, {
            state: {
                closureReasons: REASONS,
                closureReasonCode: '02',
            },
            history: [],
            flowVersionId: 'flowVersion-v1',
            lastTurnAt: new Date().toISOString(),
        })

        const action = buildSiblingsAction()
        const executionState = FlowExecutorContext.empty().upsertStep('trigger', {
            type: 'PIECE_TRIGGER' as never,
            status: StepOutputStatus.SUCCEEDED,
            input: {},
            output: { sessionId: 'sid-siblings-c', message: '' },
        } as never)

        const result = await flowExecutor.execute({
            action,
            executionState,
            constants: generateMockEngineConstants(EXECUTOR_CONSTANTS_SYNC),
        })

        expect(result.getStepOutput('interactive_flow')?.status).toBe(StepOutputStatus.PAUSED)
        const lastPut = store.putCalls[store.putCalls.length - 1]
        expect(lastPut.value.pendingInteraction?.nodeId).toBe('collect_date')
        expect(lastPut.value.state.closureDate).toBeUndefined()
    })
})
