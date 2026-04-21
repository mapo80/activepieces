import { BlocksV1Payload, InteractiveFlowNodeType, StepOutputStatus } from '@activepieces/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FlowExecutorContext } from '../../src/lib/handler/context/flow-execution-context'
import { flowExecutor } from '../../src/lib/handler/flow-executor'
import { SessionRecord } from '../../src/lib/handler/session-store'
import { workerSocket } from '../../src/lib/worker-socket'
import { buildInteractiveFlowAction, generateMockEngineConstants } from './test-helper'

type SendFlowResponseCall = {
    workerHandlerId: string
    httpRequestId: string
    runResponse: { status: number, body: unknown, headers: Record<string, string> }
}

type StoreMock = {
    records: Map<string, SessionRecord>
    putCalls: Array<{ key: string, value: SessionRecord }>
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
    const mock: StoreMock = { records: new Map(), putCalls: [] }
    vi.spyOn(global, 'fetch').mockImplementation(async (input: unknown, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : String((input as { url?: string }).url ?? input)
        if (url.includes('/v1/engine/interactive-flow-ai/question-generate')) {
            return { ok: true, status: 200, json: async () => ({ text: questionText ?? 'please', tokensUsed: 5 }) } as unknown as Response
        }
        if (url.includes('/v1/engine/interactive-flow-ai/field-extract')) {
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

describe('interactive-flow executor — blocks-v1 fase 2 (date-picker + pdf-viewer)', () => {
    beforeEach(() => { vi.restoreAllMocks() })
    afterEach(() => { vi.restoreAllMocks() })

    it('emits blocks-v1 with date-picker block when pausing on USER_INPUT with DatePickerCard render', async () => {
        const sendSpy = installSyncCaller()
        installStoreAndFetchMock({
            extractorReturns: {},
            questionText: 'Indica la data di efficacia',
        })

        const action = buildInteractiveFlowAction({
            name: 'interactive_flow',
            nodes: [
                {
                    id: 'collect_date',
                    name: 'collect_date',
                    displayName: 'Data efficacia',
                    nodeType: InteractiveFlowNodeType.USER_INPUT,
                    stateInputs: [],
                    stateOutputs: ['closureDate'],
                    render: {
                        component: 'DatePickerCard',
                        props: { format: 'YYYY-MM-DD', minDate: 'today' },
                    },
                    message: { dynamic: true },
                },
            ],
            stateFields: [
                { name: 'closureDate', type: 'string', extractable: true, parser: 'absolute-date', format: 'date' },
            ],
            mcpGatewayId: 'gw1234567890123456789A',
            fieldExtractor: { aiProviderId: 'openai', model: 'gpt-4o-mini' },
            questionGenerator: { aiProviderId: 'openai', model: 'gpt-4o' },
            locale: 'it',
        })
        action.settings.sessionIdInput = '{{trigger.sessionId}}'
        action.settings.messageInput = '{{trigger.message}}'

        const executionState = FlowExecutorContext.empty().upsertStep('trigger', {
            type: 'PIECE_TRIGGER' as never,
            status: StepOutputStatus.SUCCEEDED,
            input: {},
            output: { sessionId: 'sid-date', message: 'ciao' },
        } as never)

        await flowExecutor.execute({
            action,
            executionState,
            constants: generateMockEngineConstants(EXECUTOR_CONSTANTS_SYNC),
        })

        const call = sendSpy.mock.calls[0][0] as SendFlowResponseCall
        const body = call.runResponse.body as BlocksV1Payload
        expect(body.type).toBe('blocks-v1')
        const datePicker = body.blocks.find(b => b.type === 'date-picker') as Extract<typeof body.blocks[number], { type: 'date-picker' }>
        expect(datePicker).toBeDefined()
        expect(datePicker.format).toBe('YYYY-MM-DD')
        expect(datePicker.minDate).toBe('today')
        expect(datePicker.locale).toBe('it')
    })

    it('emits blocks-v1 with pdf-viewer + quick-replies when pausing on CONFIRM with ConfirmCard render and state.moduleBase64 set', async () => {
        const sendSpy = installSyncCaller()
        const store = installStoreAndFetchMock({
            extractorReturns: {},
            questionText: 'Confermi l\'invio?',
        })
        const priorKey = 'projectId/flow_flowId/ifsession:interactive_flow:sid-pdf'
        store.records.set(priorKey, {
            state: { moduleBase64: 'JVBERi0xLjQKJ2luZXJ0YA==', profile: { name: 'TEST' } },
            history: [],
            flowVersionId: 'flowVersion-v1',
            lastTurnAt: new Date().toISOString(),
        })

        const action = buildInteractiveFlowAction({
            name: 'interactive_flow',
            nodes: [
                {
                    id: 'confirm_closure',
                    name: 'confirm_closure',
                    displayName: 'Conferma',
                    nodeType: InteractiveFlowNodeType.CONFIRM,
                    stateInputs: ['moduleBase64', 'profile'],
                    stateOutputs: ['confirmed'],
                    render: {
                        component: 'ConfirmCard',
                        props: { sourceField: 'moduleBase64' },
                    },
                    message: { dynamic: true },
                },
            ],
            stateFields: [
                { name: 'moduleBase64', type: 'string', extractable: false },
                { name: 'profile', type: 'object', extractable: false },
                { name: 'confirmed', type: 'boolean', extractable: true },
            ],
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
            output: { sessionId: 'sid-pdf', message: '' },
        } as never)

        await flowExecutor.execute({
            action,
            executionState,
            constants: generateMockEngineConstants(EXECUTOR_CONSTANTS_SYNC),
        })

        const call = sendSpy.mock.calls[0][0] as SendFlowResponseCall
        const body = call.runResponse.body as BlocksV1Payload
        expect(body.type).toBe('blocks-v1')
        const pdf = body.blocks.find(b => b.type === 'pdf-viewer') as Extract<typeof body.blocks[number], { type: 'pdf-viewer' }>
        expect(pdf).toBeDefined()
        expect(pdf.base64).toBe('JVBERi0xLjQKJ2luZXJ0YA==')
        expect(pdf.fileName).toBe('modulo-estinzione.pdf')
        const qr = body.blocks.find(b => b.type === 'quick-replies') as Extract<typeof body.blocks[number], { type: 'quick-replies' }>
        expect(qr).toBeDefined()
        expect(qr.replies.map(r => r.payload)).toEqual(['sì confermo invio', 'no annulla'])
    })

    it('emits blocks-v1 with only quick-replies (no pdf-viewer) when CONFIRM has ConfirmCard but moduleBase64 is not set', async () => {
        const sendSpy = installSyncCaller()
        const store = installStoreAndFetchMock({
            extractorReturns: {},
            questionText: 'Confermi?',
        })
        const priorKey = 'projectId/flow_flowId/ifsession:interactive_flow:sid-no-pdf'
        store.records.set(priorKey, {
            state: { profile: { name: 'TEST' } },
            history: [],
            flowVersionId: 'flowVersion-v1',
            lastTurnAt: new Date().toISOString(),
        })

        const action = buildInteractiveFlowAction({
            name: 'interactive_flow',
            nodes: [
                {
                    id: 'confirm_closure',
                    name: 'confirm_closure',
                    displayName: 'Conferma',
                    nodeType: InteractiveFlowNodeType.CONFIRM,
                    stateInputs: ['profile'],
                    stateOutputs: ['confirmed'],
                    render: {
                        component: 'ConfirmCard',
                        props: { sourceField: 'moduleBase64' },
                    },
                    message: { dynamic: true },
                },
            ],
            stateFields: [
                { name: 'profile', type: 'object', extractable: false },
                { name: 'confirmed', type: 'boolean', extractable: true },
            ],
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
            output: { sessionId: 'sid-no-pdf', message: '' },
        } as never)

        await flowExecutor.execute({
            action,
            executionState,
            constants: generateMockEngineConstants(EXECUTOR_CONSTANTS_SYNC),
        })

        const call = sendSpy.mock.calls[0][0] as SendFlowResponseCall
        const body = call.runResponse.body as BlocksV1Payload
        expect(body.type).toBe('blocks-v1')
        expect(body.blocks.some(b => b.type === 'pdf-viewer')).toBe(false)
        expect(body.blocks.some(b => b.type === 'quick-replies')).toBe(true)
    })
})
