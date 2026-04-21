import { InteractiveFlowNodeType, StepOutputStatus } from '@activepieces/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FlowExecutorContext } from '../../src/lib/handler/context/flow-execution-context'
import { flowExecutor } from '../../src/lib/handler/flow-executor'
import { SessionRecord } from '../../src/lib/handler/session-store'
import { workerSocket } from '../../src/lib/worker-socket'
import { buildInteractiveFlowAction, generateMockEngineConstants } from './test-helper'

/*
 * These tests cover what the ENGINE does with extracted fields — i.e. how it
 * propagates them into state and how pause decisions are affected. The actual
 * policy enforcement (extractionScope, admissibility) lives in the API layer
 * (candidate-policy.ts) which is covered by its own unit test suite:
 * packages/server/api/test/unit/app/ai/candidate-policy.test.ts
 */

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
    const mock: StoreMock = { records: new Map(), putCalls: [], extractorCalls: [] }
    vi.spyOn(global, 'fetch').mockImplementation(async (input: unknown, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : String((input as { url?: string }).url ?? input)
        if (url.includes('/v1/engine/interactive-flow-ai/question-generate')) {
            return { ok: true, status: 200, json: async () => ({ text: questionText ?? 'please', tokensUsed: 5 }) } as unknown as Response
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

function buildExtinctionFlowSubset(): ReturnType<typeof buildInteractiveFlowAction> {
    const action = buildInteractiveFlowAction({
        name: 'interactive_flow',
        nodes: [
            {
                id: 'pick_ndg',
                name: 'pick_ndg',
                displayName: 'Pick NDG',
                nodeType: InteractiveFlowNodeType.USER_INPUT,
                stateInputs: [],
                stateOutputs: ['ndg'],
                render: { component: 'TextInput', props: {} },
                message: { dynamic: true },
            },
            {
                id: 'confirm_closure',
                name: 'confirm_closure',
                displayName: 'Conferma',
                nodeType: InteractiveFlowNodeType.CONFIRM,
                stateInputs: ['ndg', 'closureDate'],
                stateOutputs: ['confirmed'],
                render: { component: 'ConfirmCard', props: {} },
                message: { dynamic: true },
            },
        ],
        stateFields: [
            { name: 'ndg', type: 'string', extractable: true, parser: 'ndg', pattern: '^\\d{6,10}$' },
            { name: 'closureDate', type: 'string', extractable: true, parser: 'absolute-date', format: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            { name: 'confirmed', type: 'boolean', extractable: true, extractionScope: 'node-local' },
        ],
        mcpGatewayId: 'gw1234567890123456789A',
        fieldExtractor: { aiProviderId: 'openai', model: 'gpt-4o-mini' },
        questionGenerator: { aiProviderId: 'openai', model: 'gpt-4o' },
    })
    action.settings.sessionIdInput = '{{trigger.sessionId}}'
    action.settings.messageInput = '{{trigger.message}}'
    return action
}

describe('interactive-flow executor — engine propagation of globally-scoped extractions', () => {
    beforeEach(() => { vi.restoreAllMocks() })
    afterEach(() => { vi.restoreAllMocks() })

    it('propagates to state a data field extracted at an upstream node (global admissibility expected)', async () => {
        installSyncCaller()
        const store = installStoreAndFetchMock({
            extractorReturns: { closureDate: '2029-04-28' },
            questionText: 'Qual è il NDG?',
        })
        const action = buildExtinctionFlowSubset()
        const executionState = FlowExecutorContext.empty().upsertStep('trigger', {
            type: 'PIECE_TRIGGER' as never,
            status: StepOutputStatus.SUCCEEDED,
            input: {},
            output: { sessionId: 'sid-ge-1', message: 'vorrei estinguere dalla data 28/04/2029' },
        } as never)

        await flowExecutor.execute({
            action,
            executionState,
            constants: generateMockEngineConstants(EXECUTOR_CONSTANTS_SYNC),
        })

        const lastPut = store.putCalls[store.putCalls.length - 1]
        expect(lastPut).toBeDefined()
        expect(lastPut.value.state.closureDate).toBe('2029-04-28')
        // Pause remains on pick_ndg because ndg is still missing
        expect(lastPut.value.pendingInteraction?.nodeId).toBe('pick_ndg')
    })

    it('batch turn with ndg + closureDate resolves pick_ndg and advances to confirm_closure', async () => {
        installSyncCaller()
        const store = installStoreAndFetchMock({
            extractorReturns: { ndg: '11255521', closureDate: '2029-04-28' },
            questionText: 'Confermi?',
        })
        const action = buildExtinctionFlowSubset()
        const executionState = FlowExecutorContext.empty().upsertStep('trigger', {
            type: 'PIECE_TRIGGER' as never,
            status: StepOutputStatus.SUCCEEDED,
            input: {},
            output: { sessionId: 'sid-ge-4', message: 'NDG 11255521 dalla data 28/04/2029' },
        } as never)

        await flowExecutor.execute({
            action,
            executionState,
            constants: generateMockEngineConstants(EXECUTOR_CONSTANTS_SYNC),
        })

        const lastPut = store.putCalls[store.putCalls.length - 1]
        expect(lastPut.value.state.ndg).toBe('11255521')
        expect(lastPut.value.state.closureDate).toBe('2029-04-28')
        expect(lastPut.value.pendingInteraction?.nodeId).toBe('confirm_closure')
    })
})
