import { ActivepiecesError, ErrorCode } from '@activepieces/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getResolvedMock = vi.fn()

vi.mock('../../../../src/app/mcp-gateway/mcp-gateway.service', () => ({
    mcpGatewayService: () => ({
        getResolved: getResolvedMock,
    }),
    buildRequestHeaders: (auth: { type: string, token?: string, headerName?: string, key?: string, headerValue?: string }) => {
        switch (auth.type) {
            case 'NONE': return { 'Content-Type': 'application/json' }
            case 'BEARER': return { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` }
            case 'API_KEY': return { 'Content-Type': 'application/json', [auth.headerName!]: auth.key! }
            case 'HEADER': return { 'Content-Type': 'application/json', [auth.headerName!]: auth.headerValue! }
            default: return { 'Content-Type': 'application/json' }
        }
    },
}))

vi.mock('../../../../src/app/core/security/authorization/fastify-security', () => ({
    securityAccess: {
        engine: () => ({}),
    },
}))

async function buildRequest(id: string, platformId: string | undefined) {
    return {
        params: { id },
        principal: platformId
            ? { platform: { id: platformId }, projectId: 'proj12345678901234567X' }
            : { platform: undefined, projectId: 'proj12345678901234567X' },
        log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), trace: vi.fn(), child: vi.fn(), silent: vi.fn(), level: 'info' },
    }
}

async function runRoute(req: unknown) {
    const { mcpGatewayWorkerController } = await import('../../../../src/app/mcp-gateway/mcp-gateway-worker.controller')
    let handler: ((request: unknown) => Promise<unknown>) | undefined
    const appStub = {
        get: (_path: string, _opts: unknown, fn: (request: unknown) => Promise<unknown>) => {
            handler = fn
        },
    } as unknown as Parameters<typeof mcpGatewayWorkerController>[0]
    await mcpGatewayWorkerController(appStub, {})
    if (!handler) throw new Error('handler not registered')
    return handler(req)
}

describe('mcpGatewayWorkerController', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })
    afterEach(() => {
        vi.resetModules()
    })

    it('resolves the gateway scoped by platformId and returns url + headers with auth', async () => {
        getResolvedMock.mockResolvedValueOnce({
            id: 'gw1234567890123456789A',
            platformId: 'pf1234567890123456789A',
            name: 'Banking',
            url: 'https://gateway.example/rpc',
            description: null,
            auth: { type: 'BEARER', token: 'secret-tok' },
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
        })

        const req = await buildRequest('gw1234567890123456789A', 'pf1234567890123456789A')
        const result = await runRoute(req)

        expect(getResolvedMock).toHaveBeenCalledWith({
            id: 'gw1234567890123456789A',
            platformId: 'pf1234567890123456789A',
        })
        expect(result).toEqual({
            url: 'https://gateway.example/rpc',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer secret-tok' },
        })
    })

    it('propagates ENTITY_NOT_FOUND from the service', async () => {
        getResolvedMock.mockRejectedValueOnce(new ActivepiecesError({
            code: ErrorCode.ENTITY_NOT_FOUND,
            params: { message: 'MCP gateway not found', entityType: 'mcp_gateway', entityId: 'gwMISSING1111222233334' },
        }))
        const req = await buildRequest('gwMISSING1111222233334', 'pf1234567890123456789A')
        await expect(runRoute(req)).rejects.toMatchObject({ error: { code: ErrorCode.ENTITY_NOT_FOUND } })
    })

    it('throws when the principal has no platformId', async () => {
        const req = await buildRequest('gw1234567890123456789A', undefined)
        await expect(runRoute(req)).rejects.toThrow(/platformId/)
        expect(getResolvedMock).not.toHaveBeenCalled()
    })

    it('handles NONE auth by returning only the base content-type', async () => {
        getResolvedMock.mockResolvedValueOnce({
            id: 'gw1234567890123456789A',
            platformId: 'pf1234567890123456789A',
            name: 'Public',
            url: 'https://public.example/rpc',
            description: null,
            auth: { type: 'NONE' },
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
        })
        const req = await buildRequest('gw1234567890123456789A', 'pf1234567890123456789A')
        const result = await runRoute(req) as { headers: Record<string, string> }
        expect(result.headers).toEqual({ 'Content-Type': 'application/json' })
    })
})
