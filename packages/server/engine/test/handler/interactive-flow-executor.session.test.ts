import { FlowRunStatus, InteractiveFlowNodeType, StepOutputStatus } from '@activepieces/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FlowExecutorContext } from '../../src/lib/handler/context/flow-execution-context'
import { StepExecutionPath } from '../../src/lib/handler/context/step-execution-path'
import { flowExecutor } from '../../src/lib/handler/flow-executor'
import { workerSocket } from '../../src/lib/worker-socket'
import { buildInteractiveFlowAction, generateMockEngineConstants } from './test-helper'

type StoreMock = {
    records: Map<string, unknown>
    getCalls: string[]
    putCalls: Array<{ key: string, value: unknown }>
    deleteCalls: string[]
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

function installStoreAndFetchMock(extras?: {
    questionGeneratorText?: string
    fieldExtractorReturns?: Record<string, unknown>
}): StoreMock {
    const mock: StoreMock = {
        records: new Map(),
        getCalls: [],
        putCalls: [],
        deleteCalls: [],
    }

    vi.spyOn(global, 'fetch').mockImplementation(async (input: unknown, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : String((input as { url?: string }).url ?? input)

        if (url.includes('/v1/engine/interactive-flow-ai/question-generate')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({ text: extras?.questionGeneratorText ?? 'generated question?', tokensUsed: 10 }),
            } as unknown as Response
        }
        if (url.includes('/v1/engine/interactive-flow-ai/field-extract')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({ extractedFields: extras?.fieldExtractorReturns ?? {}, tokensUsed: 5 }),
            } as unknown as Response
        }
        if (url.includes('/v1/engine/interactive-flow-events')) {
            return { ok: true, status: 204, json: async () => null } as unknown as Response
        }
        if (url.includes('/v1/engine/mcp-gateways/')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({ url: 'http://mock-mcp/mcp', headers: {} }),
            } as unknown as Response
        }

        if (url.includes('/v1/store-entries')) {
            const method = init?.method ?? 'GET'
            const parsed = new URL(url)
            const key = parsed.searchParams.get('key') ?? ''
            if (method === 'GET') {
                mock.getCalls.push(key)
                if (!mock.records.has(key)) {
                    return { ok: false, status: 404, json: async () => null, text: async () => '' } as unknown as Response
                }
                return {
                    ok: true,
                    status: 200,
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

function buildActionWithSession(): ReturnType<typeof buildInteractiveFlowAction> {
    return buildInteractiveFlowAction({
        name: 'interactive_flow',
        nodes: [
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
                render: { component: 'TextInput', props: {} },
                message: { dynamic: true },
            },
        ],
        stateFields: [
            { name: 'customerName', type: 'string', extractable: true },
            { name: 'ndg', type: 'string', extractable: true },
            { name: 'customerMatches', type: 'array', extractable: false },
        ],
        mcpGatewayId: 'gw1234567890123456789A',
        fieldExtractor: { aiProviderId: 'openai', model: 'gpt-4o-mini' },
        questionGenerator: { aiProviderId: 'openai', model: 'gpt-4o' },
    })
}

describe('interactive-flow executor — session persistence', () => {
    beforeEach(() => { vi.restoreAllMocks() })
    afterEach(() => { vi.restoreAllMocks() })

    it('insufficient-info branch uses virtualNode + questionGenerator + persists session', async () => {
        const sendFlowResponseSpy = installSyncCaller()
        const store = installStoreAndFetchMock({
            questionGeneratorText: 'Ciao! Indicami il nome del cliente o il NDG.',
            fieldExtractorReturns: {},
        })

        const action = buildInteractiveFlowAction({
            name: 'interactive_flow',
            nodes: [
                {
                    id: 'lookup',
                    name: 'lookup',
                    displayName: 'Lookup',
                    nodeType: InteractiveFlowNodeType.TOOL,
                    stateInputs: ['customerName'],
                    stateOutputs: ['customer'],
                    tool: 'banking/lookup',
                },
            ],
            stateFields: [
                { name: 'customerName', type: 'string', extractable: true },
                { name: 'customer', type: 'object', extractable: false },
            ],
            mcpGatewayId: 'gw1234567890123456789A',
            fieldExtractor: { aiProviderId: 'openai', model: 'gpt-4o' },
            questionGenerator: { aiProviderId: 'openai', model: 'gpt-4o' },
        })
        action.settings.sessionIdInput = '{{trigger.sessionId}}'
        action.settings.messageInput = '{{trigger.message}}'

        const executionState = FlowExecutorContext.empty().upsertStep('trigger', {
            type: 'PIECE_TRIGGER' as never,
            status: StepOutputStatus.SUCCEEDED,
            input: {},
            output: { sessionId: 'sid-1', message: 'ciao' },
        } as never)

        const result = await flowExecutor.execute({
            action,
            executionState,
            constants: generateMockEngineConstants(EXECUTOR_CONSTANTS_SYNC),
        })

        expect(result.getStepOutput('interactive_flow')?.status).toBe(StepOutputStatus.SUCCEEDED)
        expect(sendFlowResponseSpy).toHaveBeenCalledTimes(1)
        const body = (sendFlowResponseSpy.mock.calls[0][0] as { runResponse: { body: Record<string, unknown> } }).runResponse.body
        expect(body.value).toBe('Ciao! Indicami il nome del cliente o il NDG.')
        expect(store.putCalls).toHaveLength(1)
        expect(store.putCalls[0].key).toContain('ifsession:interactive_flow:sid-1')
        const persisted = store.putCalls[0].value as { state: unknown, history: Array<{ role: string, text: string }> }
        expect(persisted.history.map(h => h.role)).toEqual(['user', 'assistant'])
    })

    it('loads prior session state on second turn and skips re-asking already-known fields', async () => {
        installSyncCaller()
        const store = installStoreAndFetchMock({
            questionGeneratorText: 'Scegli il NDG',
            fieldExtractorReturns: {},
        })
        const action = buildActionWithSession()
        action.settings.sessionIdInput = '{{trigger.sessionId}}'
        action.settings.messageInput = '{{trigger.message}}'

        const priorKey = `projectId/flow_flowId/ifsession:interactive_flow:sid-2`
        store.records.set(priorKey, {
            state: { customerName: 'Bellafronte', customerMatches: [{ ndg: '11255521' }] },
            history: [{ role: 'user', text: 'Bellafronte' }, { role: 'assistant', text: 'ho trovato…' }],
            flowVersionId: 'flowVersion-v1',
            lastTurnAt: '2026-04-20T09:00:00Z',
        })

        const executionState = FlowExecutorContext.empty().upsertStep('trigger', {
            type: 'PIECE_TRIGGER' as never,
            status: StepOutputStatus.SUCCEEDED,
            input: {},
            output: { sessionId: 'sid-2', message: 'procedi' },
        } as never)

        const result = await flowExecutor.execute({
            action,
            executionState,
            constants: generateMockEngineConstants(EXECUTOR_CONSTANTS_SYNC),
        })

        expect(result.verdict.status).toBe(FlowRunStatus.PAUSED)
        const output = result.getStepOutput('interactive_flow')?.output as Record<string, unknown>
        expect(output.state).toMatchObject({ customerName: 'Bellafronte', customerMatches: [{ ndg: '11255521' }] })
        expect(output.currentNodeId).toBe('pick_ndg')
    })

    it('flowVersionId mismatch resets the persisted state', async () => {
        installSyncCaller()
        const store = installStoreAndFetchMock({
            questionGeneratorText: 'Qual è il nome del cliente?',
            fieldExtractorReturns: {},
        })
        const action = buildActionWithSession()
        action.settings.sessionIdInput = '{{trigger.sessionId}}'
        action.settings.messageInput = '{{trigger.message}}'

        const priorKey = `projectId/flow_flowId/ifsession:interactive_flow:sid-3`
        store.records.set(priorKey, {
            state: { customerName: 'Bellafronte', customerMatches: [{ ndg: '999' }] },
            history: [{ role: 'user', text: 'vecchio' }],
            flowVersionId: 'flowVersion-OLD',
            lastTurnAt: '2025-01-01T00:00:00Z',
        })

        const executionState = FlowExecutorContext.empty().upsertStep('trigger', {
            type: 'PIECE_TRIGGER' as never,
            status: StepOutputStatus.SUCCEEDED,
            input: {},
            output: { sessionId: 'sid-3', message: 'ciao' },
        } as never)

        const result = await flowExecutor.execute({
            action,
            executionState,
            constants: generateMockEngineConstants(EXECUTOR_CONSTANTS_SYNC),
        })

        const output = result.getStepOutput('interactive_flow')?.output as Record<string, unknown>
        expect(output.state).toEqual({})
    })

    it('topic-change (different customerName) clears non-extractable tool outputs from state', async () => {
        installSyncCaller()
        const store = installStoreAndFetchMock({
            questionGeneratorText: 'Ho trovato Rossi.',
            fieldExtractorReturns: { customerName: 'Rossi' },
        })
        const action = buildActionWithSession()
        action.settings.sessionIdInput = '{{trigger.sessionId}}'
        action.settings.messageInput = '{{trigger.message}}'

        const priorKey = `projectId/flow_flowId/ifsession:interactive_flow:sid-4`
        store.records.set(priorKey, {
            state: { customerName: 'Bellafronte', customerMatches: [{ ndg: '11255521' }] },
            history: [{ role: 'user', text: 'Bellafronte' }],
            flowVersionId: 'flowVersion-v1',
            lastTurnAt: '2026-04-20T09:00:00Z',
        })

        const executionState = FlowExecutorContext.empty().upsertStep('trigger', {
            type: 'PIECE_TRIGGER' as never,
            status: StepOutputStatus.SUCCEEDED,
            input: {},
            output: { sessionId: 'sid-4', message: 'no scusa Rossi' },
        } as never)

        const result = await flowExecutor.execute({
            action,
            executionState,
            constants: generateMockEngineConstants(EXECUTOR_CONSTANTS_SYNC),
        })

        const output = result.getStepOutput('interactive_flow')?.output as Record<string, unknown>
        const state = output.state as Record<string, unknown>
        expect(state.customerName).toBe('Rossi')
        expect(state.ndg).toBeUndefined()
        const toolCalls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
            .filter((c: unknown[]) => {
                const url = typeof c[0] === 'string' ? c[0] : String((c[0] as { url?: string }).url ?? c[0])
                return url.includes('http://mock-mcp/mcp')
            })
        expect(toolCalls.length).toBeGreaterThan(0)
        const toolBody = JSON.parse(String((toolCalls[0][1] as RequestInit).body))
        expect(toolBody.params.name).toBe('banking/search')
    })

    it('success + cleanupOnSuccess:true deletes the session record', async () => {
        installSyncCaller()
        const store = installStoreAndFetchMock()
        const action = buildInteractiveFlowAction({
            name: 'interactive_flow',
            nodes: [
                {
                    id: 'done',
                    name: 'done',
                    displayName: 'Done',
                    nodeType: InteractiveFlowNodeType.TOOL,
                    stateInputs: [],
                    stateOutputs: ['caseId'],
                    tool: 'banking/finalize',
                },
            ],
            stateFields: [{ name: 'caseId', type: 'string', extractable: false }],
            mcpGatewayId: 'gw1234567890123456789A',
        })
        action.settings.sessionIdInput = '{{trigger.sessionId}}'
        action.settings.cleanupOnSuccess = true

        vi.spyOn(global, 'fetch').mockRestore()
        const calls: Array<{ url: string, method: string }> = []
        vi.spyOn(global, 'fetch').mockImplementation(async (input: unknown, init?: RequestInit) => {
            const url = typeof input === 'string' ? input : String((input as { url?: string }).url ?? input)
            const method = init?.method ?? 'GET'
            calls.push({ url, method })
            if (url.includes('/v1/engine/mcp-gateways/')) {
                return { ok: true, status: 200, json: async () => ({ url: 'http://mock-mcp/mcp', headers: {} }) } as unknown as Response
            }
            if (url.includes('/v1/engine/interactive-flow-events')) {
                return { ok: true, status: 204, json: async () => null } as unknown as Response
            }
            if (url.includes('/v1/store-entries')) {
                if (method === 'DELETE') {
                    store.deleteCalls.push(url)
                    return { ok: true, status: 204, json: async () => null } as unknown as Response
                }
                if (method === 'GET') return { ok: false, status: 404, json: async () => null, text: async () => '' } as unknown as Response
                return { ok: true, status: 200, json: async () => ({}) } as unknown as Response
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({ result: { content: [{ type: 'text', text: JSON.stringify({ caseId: 'ES-2026-0001' }) }] } }),
            } as unknown as Response
        })

        const executionState = FlowExecutorContext.empty().upsertStep('trigger', {
            type: 'PIECE_TRIGGER' as never,
            status: StepOutputStatus.SUCCEEDED,
            input: {},
            output: { sessionId: 'sid-success' },
        } as never)

        const result = await flowExecutor.execute({
            action,
            executionState,
            constants: generateMockEngineConstants(EXECUTOR_CONSTANTS_SYNC),
        })

        expect(result.getStepOutput('interactive_flow')?.status).toBe(StepOutputStatus.SUCCEEDED)
        expect(store.deleteCalls.length).toBeGreaterThan(0)
    })

    it('success + cleanupOnSuccess:false keeps session record (assistant-style flow)', async () => {
        installSyncCaller()
        const store = installStoreAndFetchMock()
        const action = buildInteractiveFlowAction({
            name: 'interactive_flow',
            nodes: [
                {
                    id: 'done',
                    name: 'done',
                    displayName: 'Done',
                    nodeType: InteractiveFlowNodeType.TOOL,
                    stateInputs: [],
                    stateOutputs: ['result'],
                    tool: 'banking/finalize',
                },
            ],
            stateFields: [{ name: 'result', type: 'string', extractable: false }],
            mcpGatewayId: 'gw1234567890123456789A',
        })
        action.settings.sessionIdInput = '{{trigger.sessionId}}'
        action.settings.cleanupOnSuccess = false

        vi.spyOn(global, 'fetch').mockRestore()
        vi.spyOn(global, 'fetch').mockImplementation(async (input: unknown, init?: RequestInit) => {
            const url = typeof input === 'string' ? input : String((input as { url?: string }).url ?? input)
            const method = init?.method ?? 'GET'
            if (url.includes('/v1/engine/mcp-gateways/')) {
                return { ok: true, status: 200, json: async () => ({ url: 'http://mock-mcp/mcp', headers: {} }) } as unknown as Response
            }
            if (url.includes('/v1/engine/interactive-flow-events')) {
                return { ok: true, status: 204, json: async () => null } as unknown as Response
            }
            if (url.includes('/v1/store-entries')) {
                if (method === 'POST') {
                    const body = JSON.parse(String(init?.body))
                    store.putCalls.push({ key: body.key, value: body.value })
                    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response
                }
                if (method === 'DELETE') {
                    store.deleteCalls.push(url)
                    return { ok: true, status: 204, json: async () => null } as unknown as Response
                }
                return { ok: false, status: 404, json: async () => null, text: async () => '' } as unknown as Response
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({ result: { content: [{ type: 'text', text: JSON.stringify({ result: 'ok' }) }] } }),
            } as unknown as Response
        })

        const executionState = FlowExecutorContext.empty().upsertStep('trigger', {
            type: 'PIECE_TRIGGER' as never,
            status: StepOutputStatus.SUCCEEDED,
            input: {},
            output: { sessionId: 'sid-keep' },
        } as never)

        const result = await flowExecutor.execute({
            action,
            executionState,
            constants: generateMockEngineConstants(EXECUTOR_CONSTANTS_SYNC),
        })

        expect(result.getStepOutput('interactive_flow')?.status).toBe(StepOutputStatus.SUCCEEDED)
        expect(store.deleteCalls.length).toBe(0)
        expect(store.putCalls.length).toBeGreaterThan(0)
    })

    it('missing sessionIdInput (legacy flow) → executor works without any store I/O', async () => {
        const sendFlowResponseSpy = installSyncCaller()
        const store = installStoreAndFetchMock({
            questionGeneratorText: 'Nome cliente?',
        })
        const action = buildInteractiveFlowAction({
            name: 'interactive_flow',
            nodes: [{
                id: 'ask_name',
                name: 'ask_name',
                displayName: 'Ask',
                nodeType: InteractiveFlowNodeType.USER_INPUT,
                stateInputs: [],
                stateOutputs: ['customerName'],
                render: { component: 'TextInput', props: {} },
                message: { dynamic: true },
            }],
            stateFields: [{ name: 'customerName', type: 'string', extractable: true }],
            questionGenerator: { aiProviderId: 'openai', model: 'gpt-4o' },
        })

        const result = await flowExecutor.execute({
            action,
            executionState: FlowExecutorContext.empty(),
            constants: generateMockEngineConstants(EXECUTOR_CONSTANTS_SYNC),
        })

        expect(result.verdict.status).toBe(FlowRunStatus.PAUSED)
        expect(sendFlowResponseSpy).toHaveBeenCalledTimes(1)
        expect(store.getCalls.length).toBe(0)
        expect(store.putCalls.length).toBe(0)
    })

    it('sharing namespace across two IF actions → same storage key (pipeline case)', async () => {
        installSyncCaller()
        const store = installStoreAndFetchMock({
            questionGeneratorText: 'Dimmi il nome cliente',
            fieldExtractorReturns: {},
        })
        const actionA = buildInteractiveFlowAction({
            name: 'estinzione',
            nodes: [{
                id: 'ask_ndg_A',
                name: 'ask_ndg_A',
                displayName: 'Ask NDG A',
                nodeType: InteractiveFlowNodeType.USER_INPUT,
                stateInputs: [],
                stateOutputs: ['ndg'],
                render: { component: 'TextInput', props: {} },
                message: { dynamic: true },
            }],
            stateFields: [{ name: 'ndg', type: 'string', extractable: true }],
            questionGenerator: { aiProviderId: 'openai', model: 'gpt-4o' },
        })
        actionA.settings.sessionIdInput = '{{trigger.sessionId}}'
        actionA.settings.sessionNamespace = 'banking-conv'
        actionA.settings.cleanupOnSuccess = false

        const executionState = FlowExecutorContext.empty().upsertStep('trigger', {
            type: 'PIECE_TRIGGER' as never,
            status: StepOutputStatus.SUCCEEDED,
            input: {},
            output: { sessionId: 'sid-pipeline' },
        } as never)

        await flowExecutor.execute({
            action: actionA,
            executionState,
            constants: generateMockEngineConstants(EXECUTOR_CONSTANTS_SYNC),
        })

        expect(store.putCalls.length).toBe(1)
        expect(store.putCalls[0].key).toContain('ifsession:banking-conv:sid-pipeline')
    })

    it('append history flows user+assistant turns through questionGenerator context', async () => {
        installSyncCaller()
        const store = installStoreAndFetchMock({
            questionGeneratorText: 'Ok, dimmi il rapporto',
            fieldExtractorReturns: {},
        })
        const action = buildActionWithSession()
        action.settings.sessionIdInput = '{{trigger.sessionId}}'
        action.settings.messageInput = '{{trigger.message}}'

        const priorKey = `projectId/flow_flowId/ifsession:interactive_flow:sid-hist`
        store.records.set(priorKey, {
            state: { customerName: 'Bellafronte', customerMatches: [{ ndg: '11255521' }] },
            history: [
                { role: 'user', text: 'Bellafronte' },
                { role: 'assistant', text: 'ho trovato NDG 11255521' },
            ],
            flowVersionId: 'flowVersion-v1',
            lastTurnAt: '2026-04-20T09:00:00Z',
        })

        const executionState = FlowExecutorContext.empty().upsertStep('trigger', {
            type: 'PIECE_TRIGGER' as never,
            status: StepOutputStatus.SUCCEEDED,
            input: {},
            output: { sessionId: 'sid-hist', message: 'si procedi' },
        } as never)

        await flowExecutor.execute({
            action,
            executionState,
            constants: generateMockEngineConstants(EXECUTOR_CONSTANTS_SYNC),
        })

        const questionGenCalls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
            .filter((c: unknown[]) => {
                const url = typeof c[0] === 'string' ? c[0] : String((c[0] as { url?: string }).url ?? c[0])
                return url.includes('/v1/engine/interactive-flow-ai/question-generate')
            })
        expect(questionGenCalls.length).toBeGreaterThan(0)
        const body = JSON.parse(String((questionGenCalls[0][1] as RequestInit).body))
        const historyTexts = (body.history as Array<{ text: string }>).map((h) => h.text)
        expect(historyTexts).toContain('Bellafronte')
        expect(historyTexts).toContain('ho trovato NDG 11255521')
        expect(historyTexts).toContain('si procedi')
    })

    it('persists on pause path (written state survives for next turn)', async () => {
        installSyncCaller()
        const store = installStoreAndFetchMock({
            questionGeneratorText: 'Scegli il NDG tra i clienti trovati',
            fieldExtractorReturns: { customerName: 'Polito' },
        })
        const action = buildActionWithSession()
        action.settings.sessionIdInput = '{{trigger.sessionId}}'
        action.settings.messageInput = '{{trigger.message}}'

        vi.spyOn(global, 'fetch').mockRestore()
        vi.spyOn(global, 'fetch').mockImplementation(async (input: unknown, init?: RequestInit) => {
            const url = typeof input === 'string' ? input : String((input as { url?: string }).url ?? input)
            const method = init?.method ?? 'GET'
            if (url.includes('question-generate')) {
                return { ok: true, status: 200, json: async () => ({ text: 'Scegli il NDG' }) } as unknown as Response
            }
            if (url.includes('field-extract')) {
                return { ok: true, status: 200, json: async () => ({ extractedFields: { customerName: 'Polito' } }) } as unknown as Response
            }
            if (url.includes('interactive-flow-events')) {
                return { ok: true, status: 204, json: async () => null } as unknown as Response
            }
            if (url.includes('mcp-gateways/')) {
                return { ok: true, status: 200, json: async () => ({ url: 'http://mock-mcp/mcp', headers: {} }) } as unknown as Response
            }
            if (url.includes('v1/store-entries')) {
                if (method === 'POST') {
                    const body = JSON.parse(String(init?.body))
                    store.putCalls.push({ key: body.key, value: body.value })
                    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response
                }
                return { ok: false, status: 404, json: async () => null, text: async () => '' } as unknown as Response
            }
            if (url.includes('http://mock-mcp/mcp')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        result: {
                            content: [{ type: 'text', text: JSON.stringify([{ ndg: '11255521', denominazione: 'POLITO' }]) }],
                        },
                    }),
                } as unknown as Response
            }
            return { ok: true, status: 200, json: async () => ({}) } as unknown as Response
        })

        const executionState = FlowExecutorContext.empty().upsertStep('trigger', {
            type: 'PIECE_TRIGGER' as never,
            status: StepOutputStatus.SUCCEEDED,
            input: {},
            output: { sessionId: 'sid-persist', message: 'Polito' },
        } as never)

        const result = await flowExecutor.execute({
            action,
            executionState,
            constants: generateMockEngineConstants(EXECUTOR_CONSTANTS_SYNC),
        })

        expect(result.verdict.status).toBe(FlowRunStatus.PAUSED)
        expect(store.putCalls.length).toBeGreaterThan(0)
        const persisted = store.putCalls[store.putCalls.length - 1].value as { state: Record<string, unknown>, history: Array<{ role: string, text: string }> }
        expect(persisted.state.customerName).toBe('Polito')
        expect(persisted.history.map(h => h.role)).toEqual(['user', 'assistant'])
    })
})
