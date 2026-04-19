import { WebsocketClientEvent } from '@activepieces/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const emitMock = vi.fn()
const toMock = vi.fn(() => ({ emit: emitMock }))

vi.mock('../../../../src/app/core/websockets.service', () => ({
    websocketService: { to: toMock },
}))

vi.mock('../../../../src/app/core/security/authorization/fastify-security', () => ({
    securityAccess: {
        engine: (): Record<string, never> => ({}),
    },
}))

type HandlerMap = Record<string, (request: unknown, reply: unknown) => Promise<unknown>>

async function runHandler({ request }: { request: unknown }): Promise<{ replyStatus: number }> {
    const handlers: HandlerMap = {}
    const appStub = {
        post: (p: string, _opts: unknown, fn: (r: unknown, reply: unknown) => Promise<unknown>): void => {
            handlers[p] = fn
        },
    } as unknown as Parameters<typeof import('../../../../src/app/flows/flow-run/interactive-flow-events-controller').interactiveFlowEventsController>[0]
    const { interactiveFlowEventsController } = await import('../../../../src/app/flows/flow-run/interactive-flow-events-controller')
    await interactiveFlowEventsController(appStub, {})
    let replyStatus = 200
    const reply = {
        code(n: number): typeof reply {
            replyStatus = n
            return reply
        },
        async send(): Promise<void> {
            return
        },
    }
    await handlers['/'](request, reply)
    return { replyStatus }
}

describe('interactiveFlowEventsController', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.resetModules()
    })

    it('fans out the event to the project socket room and replies 204', async () => {
        const body = {
            flowRunId: 'run_abc',
            stepName: 'interactive_flow',
            nodeId: 'n1',
            kind: 'STARTED' as const,
            timestamp: '2026-04-17T00:00:00.000Z',
        }
        const { replyStatus } = await runHandler({
            request: {
                principal: { projectId: 'prj_1' },
                body,
                log: {},
            },
        })

        expect(toMock).toHaveBeenCalledWith('prj_1')
        expect(emitMock).toHaveBeenCalledWith(WebsocketClientEvent.INTERACTIVE_FLOW_NODE_STATE, body)
        expect(replyStatus).toBe(204)
    })

    it('throws when principal has no projectId', async () => {
        await expect(runHandler({
            request: {
                principal: {},
                body: {
                    flowRunId: 'r',
                    stepName: 's',
                    nodeId: 'n',
                    kind: 'PAUSED',
                    timestamp: '2026-04-17T00:00:00.000Z',
                },
                log: {},
            },
        })).rejects.toThrow(/projectId/)
    })
})
