import { FlowRunStatus, InteractiveFlowNodeType, PendingInteraction, StepOutputStatus } from '@activepieces/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FlowExecutorContext } from '../../src/lib/handler/context/flow-execution-context'
import { flowExecutor } from '../../src/lib/handler/flow-executor'
import { SessionRecord } from '../../src/lib/handler/session-store'
import { workerSocket } from '../../src/lib/worker-socket'
import { buildInteractiveFlowAction, generateMockEngineConstants } from './test-helper'

type StoreMock = {
    records: Map<string, SessionRecord>
    putCalls: Array<{ key: string, value: SessionRecord }>
    deleteCalls: string[]
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

function installStoreAndFetchMock({ extractorReturns, extractorResponse, questionText }: {
    extractorReturns?: Record<string, unknown>
    extractorResponse?: Record<string, unknown>
    questionText?: string
}): StoreMock {
    const mock: StoreMock = {
        records: new Map(),
        putCalls: [],
        deleteCalls: [],
        extractorCalls: [],
    }
    vi.spyOn(global, 'fetch').mockImplementation(async (input: unknown, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : String((input as { url?: string }).url ?? input)

        if (url.includes('/v1/engine/interactive-flow-ai/question-generate')) {
            return {
                ok: true, status: 200,
                json: async () => ({ text: questionText ?? 'please select one', tokensUsed: 5 }),
            } as unknown as Response
        }
        if (url.includes('/v1/engine/interactive-flow-ai/field-extract')) {
            const body = JSON.parse(String(init?.body ?? '{}'))
            mock.extractorCalls.push(body)
            const defaultResp = { extractedFields: extractorReturns ?? {}, tokensUsed: 5 }
            const resp = extractorResponse ?? defaultResp
            return {
                ok: true, status: 200,
                json: async () => resp,
            } as unknown as Response
        }
        if (url.includes('/v1/engine/interactive-flow-events')) {
            return { ok: true, status: 204, json: async () => null } as unknown as Response
        }
        if (url.includes('/v1/engine/mcp-gateways/')) {
            return {
                ok: true, status: 200,
                json: async () => ({ url: 'http://mock-mcp/mcp', headers: {} }),
            } as unknown as Response
        }
        if (url.includes('/v1/store-entries')) {
            const method = init?.method ?? 'GET'
            const parsed = new URL(url)
            const key = parsed.searchParams.get('key') ?? ''
            if (method === 'GET') {
                if (!mock.records.has(key)) {
                    return { ok: false, status: 404, json: async () => null, text: async () => '' } as unknown as Response
                }
                return {
                    ok: true, status: 200,
                    json: async () => ({ value: mock.records.get(key) }),
                } as unknown as Response
            }
            if (method === 'POST') {
                const body = JSON.parse(String(init?.body))
                mock.putCalls.push({ key: body.key, value: body.value })
                mock.records.set(body.key, body.value)
                return { ok: true, status: 200, json: async () => ({}) } as unknown as Response
            }
            if (method === 'DELETE') {
                mock.deleteCalls.push(key)
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

function buildPickNdgAction(): ReturnType<typeof buildInteractiveFlowAction> {
    const action = buildInteractiveFlowAction({
        name: 'interactive_flow',
        nodes: [
            {
                id: 'ask_customer',
                name: 'ask_customer',
                displayName: 'Ask customer',
                nodeType: InteractiveFlowNodeType.USER_INPUT,
                stateInputs: [],
                stateOutputs: ['customerName'],
                render: { component: 'TextInput', props: {} },
                message: { dynamic: true },
            },
            {
                id: 'search_customer',
                name: 'search_customer',
                displayName: 'Search customer',
                nodeType: InteractiveFlowNodeType.TOOL,
                stateInputs: ['customerName'],
                stateOutputs: ['customerMatches'],
                tool: 'banking/search',
            },
            {
                id: 'pick_ndg',
                name: 'pick_ndg',
                displayName: 'Pick NDG',
                nodeType: InteractiveFlowNodeType.USER_INPUT,
                stateInputs: ['customerMatches'],
                stateOutputs: ['ndg'],
                render: { component: 'DataTable', props: { sourceField: 'customerMatches', optionValueField: 'ndg', optionLabelField: 'name' } },
                message: { dynamic: true },
            },
            {
                id: 'confirm_closure',
                name: 'confirm_closure',
                displayName: 'Confirm closure',
                nodeType: InteractiveFlowNodeType.CONFIRM,
                stateInputs: ['ndg'],
                stateOutputs: ['confirmed'],
                render: { component: 'ConfirmPrompt', props: {} },
                message: { dynamic: true },
            },
        ],
        stateFields: [
            { name: 'customerName', type: 'string', extractable: true },
            { name: 'ndg', type: 'string', extractable: true },
            { name: 'customerMatches', type: 'array', extractable: false },
            { name: 'confirmed', type: 'boolean', extractable: false },
        ],
        mcpGatewayId: 'gw1234567890123456789A',
        fieldExtractor: { aiProviderId: 'openai', model: 'gpt-4o-mini' },
        questionGenerator: { aiProviderId: 'openai', model: 'gpt-4o' },
    })
    action.settings.sessionIdInput = '{{trigger.sessionId}}'
    action.settings.messageInput = '{{trigger.message}}'
    return action
}

describe('interactive-flow executor — pendingInteraction lifecycle', () => {
    beforeEach(() => { vi.restoreAllMocks() })
    afterEach(() => { vi.restoreAllMocks() })

    it('writes pendingInteraction=pick_from_list when pausing on a USER_INPUT node with sourceField-backed state', async () => {
        installSyncCaller()
        const matches = [
            { ndg: '111', name: 'ROSSI MARIO' },
            { ndg: '222', name: 'ROSSI GIULIO' },
        ]
        const store = installStoreAndFetchMock({
            extractorReturns: { customerName: 'Rossi', customerMatches: matches },
            questionText: 'Seleziona un cliente:',
        })

        const action = buildPickNdgAction()
        const executionState = FlowExecutorContext.empty().upsertStep('trigger', {
            type: 'PIECE_TRIGGER' as never,
            status: StepOutputStatus.SUCCEEDED,
            input: {},
            output: { sessionId: 'sid-pick', message: 'Rossi' },
        } as never)

        const result = await flowExecutor.execute({
            action,
            executionState,
            constants: generateMockEngineConstants(EXECUTOR_CONSTANTS_SYNC),
        })

        expect(result.getStepOutput('interactive_flow')?.status).toBe(StepOutputStatus.PAUSED)
        const lastPut = store.putCalls[store.putCalls.length - 1]
        expect(lastPut.value.pendingInteraction).toEqual({
            type: 'pick_from_list',
            field: 'ndg',
            options: [
                { ordinal: 1, label: 'ROSSI MARIO', value: '111' },
                { ordinal: 2, label: 'ROSSI GIULIO', value: '222' },
            ],
            nodeId: 'pick_ndg',
        })
    })

    it('writes pendingInteraction=confirm_binary when pausing on a CONFIRM node', async () => {
        installSyncCaller()
        const store = installStoreAndFetchMock({
            extractorReturns: { customerName: 'Rossi', ndg: '111', customerMatches: [{ ndg: '111', name: 'ROSSI' }] },
            questionText: 'Confermi?',
        })

        const action = buildPickNdgAction()
        const executionState = FlowExecutorContext.empty().upsertStep('trigger', {
            type: 'PIECE_TRIGGER' as never,
            status: StepOutputStatus.SUCCEEDED,
            input: {},
            output: { sessionId: 'sid-confirm', message: 'Rossi ndg 111' },
        } as never)

        const result = await flowExecutor.execute({
            action,
            executionState,
            constants: generateMockEngineConstants(EXECUTOR_CONSTANTS_SYNC),
        })

        expect(result.getStepOutput('interactive_flow')?.status).toBe(StepOutputStatus.PAUSED)
        const lastPut = store.putCalls[store.putCalls.length - 1]
        expect(lastPut.value.pendingInteraction?.type).toBe('confirm_binary')
        expect(lastPut.value.pendingInteraction?.field).toBe('confirmed')
        expect(lastPut.value.pendingInteraction?.nodeId).toBe('confirm_closure')
    })

    it('passes previous pendingInteraction to field-extractor on the next turn', async () => {
        installSyncCaller()
        const priorPending: PendingInteraction = {
            type: 'pick_from_list',
            field: 'ndg',
            options: [
                { ordinal: 1, label: 'ROSSI MARIO', value: '111' },
                { ordinal: 2, label: 'ROSSI GIULIO', value: '222' },
            ],
            nodeId: 'pick_ndg',
        }
        const store = installStoreAndFetchMock({
            extractorReturns: {},
            questionText: 'Select',
        })
        const priorKey = 'projectId/flow_flowId/ifsession:interactive_flow:sid-next'
        store.records.set(priorKey, {
            state: { customerName: 'Rossi', customerMatches: [{ ndg: '111', name: 'ROSSI MARIO' }, { ndg: '222', name: 'ROSSI GIULIO' }] },
            history: [{ role: 'user', text: 'Rossi' }, { role: 'assistant', text: 'Seleziona' }],
            flowVersionId: 'flowVersion-v1',
            lastTurnAt: new Date().toISOString(),
            pendingInteraction: priorPending,
        })

        const action = buildPickNdgAction()
        const executionState = FlowExecutorContext.empty().upsertStep('trigger', {
            type: 'PIECE_TRIGGER' as never,
            status: StepOutputStatus.SUCCEEDED,
            input: {},
            output: { sessionId: 'sid-next', message: 'il secondo' },
        } as never)

        await flowExecutor.execute({
            action,
            executionState,
            constants: generateMockEngineConstants(EXECUTOR_CONSTANTS_SYNC),
        })

        expect(store.extractorCalls.length).toBeGreaterThan(0)
        expect(store.extractorCalls[0].pendingInteraction).toEqual(priorPending)
    })

    it('emits pending-overwrite bubble and persists pendingInteraction=pending_overwrite when controller decides confirm', async () => {
        const sendSpy = installSyncCaller()
        const store = installStoreAndFetchMock({
            extractorResponse: {
                extractedFields: {},
                turnAffirmed: false,
                policyDecisions: [
                    {
                        field: 'customerName',
                        action: 'confirm',
                        reason: 'overwrite-needs-cue',
                        pendingOverwrite: {
                            field: 'customerName',
                            oldValue: 'Bellafronte',
                            newValue: 'Rossi',
                        },
                    },
                ],
            },
            questionText: 'irrelevant',
        })

        const action = buildPickNdgAction()
        const priorKey = 'projectId/flow_flowId/ifsession:interactive_flow:sid-overwrite'
        store.records.set(priorKey, {
            state: { customerName: 'Bellafronte' },
            history: [{ role: 'user', text: 'Bellafronte' }],
            flowVersionId: 'flowVersion-v1',
            lastTurnAt: new Date().toISOString(),
        })

        const executionState = FlowExecutorContext.empty().upsertStep('trigger', {
            type: 'PIECE_TRIGGER' as never,
            status: StepOutputStatus.SUCCEEDED,
            input: {},
            output: { sessionId: 'sid-overwrite', message: 'Rossi' },
        } as never)

        const result = await flowExecutor.execute({
            action,
            executionState,
            constants: generateMockEngineConstants(EXECUTOR_CONSTANTS_SYNC),
        })

        expect(result.getStepOutput('interactive_flow')?.status).toBe(StepOutputStatus.SUCCEEDED)
        const bodyCall = (sendSpy.mock.calls[0][0] as { runResponse: { body: { value: string } } }).runResponse.body
        expect(bodyCall.value).toMatch(/cambiare.+customerName/i)
        expect(bodyCall.value).toMatch(/Bellafronte/)
        expect(bodyCall.value).toMatch(/Rossi/)
        const lastPut = store.putCalls[store.putCalls.length - 1]
        expect(lastPut.value.pendingInteraction).toEqual({
            type: 'pending_overwrite',
            field: 'customerName',
            oldValue: 'Bellafronte',
            newValue: 'Rossi',
            nodeId: expect.any(String),
        })
    })

    it('does not pass pendingInteraction on the very first turn (no prior session)', async () => {
        installSyncCaller()
        const store = installStoreAndFetchMock({
            extractorReturns: {},
            questionText: 'chi?',
        })
        const action = buildPickNdgAction()
        const executionState = FlowExecutorContext.empty().upsertStep('trigger', {
            type: 'PIECE_TRIGGER' as never,
            status: StepOutputStatus.SUCCEEDED,
            input: {},
            output: { sessionId: 'sid-fresh', message: 'ciao' },
        } as never)
        await flowExecutor.execute({
            action,
            executionState,
            constants: generateMockEngineConstants(EXECUTOR_CONSTANTS_SYNC),
        })
        expect(store.extractorCalls[0]?.pendingInteraction).toBeUndefined()
    })
})
