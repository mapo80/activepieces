import { FastifyBaseLogger } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const findMock = vi.fn()
const findOneMock = vi.fn()

vi.mock('../../../../src/app/core/db/repo-factory', () => ({
    repoFactory: (): (() => {
        insert: ReturnType<typeof vi.fn>
        find: typeof findMock
        findOne: typeof findOneMock
        update: ReturnType<typeof vi.fn>
        delete: ReturnType<typeof vi.fn>
    }) => () => ({
        insert: vi.fn(),
        find: findMock,
        findOne: findOneMock,
        update: vi.fn(),
        delete: vi.fn(),
    }),
}))

const decryptObjectMock = vi.fn()
vi.mock('../../../../src/app/helper/encryption', () => ({
    encryptUtils: {
        encryptObject: vi.fn(),
        decryptObject: <T>(o: unknown): Promise<T> => decryptObjectMock(o) as Promise<T>,
    },
    EncryptedObject: {},
}))

vi.mock('@activepieces/shared', async () => {
    const actual = await vi.importActual<typeof import('@activepieces/shared')>('@activepieces/shared')
    return { ...actual, apId: (): string => 'stub_1234567890123456789' }
})

const STUB_LOG = {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    fatal: vi.fn(), trace: vi.fn(), child: vi.fn(), silent: vi.fn(), level: 'info',
} as unknown as FastifyBaseLogger

const PLATFORM_ID = 'pf1234567890123456789'
const GATEWAY_ID = 'gw1234567890123456789'

function record(): Record<string, unknown> {
    const now = new Date().toISOString()
    return {
        id: GATEWAY_ID, created: now, updated: now,
        platformId: PLATFORM_ID, name: 'GW', url: 'https://gw.example/rpc',
        description: null, auth: { iv: 'iv', data: 'data' },
    }
}

describe('mcpGatewayService.diffTools', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.resetModules()
    })

    it('marks known tools as OK when snapshot matches live schema', async () => {
        findOneMock.mockResolvedValue(record())
        decryptObjectMock.mockResolvedValue({ type: 'NONE' })
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async (): Promise<unknown> => ({ result: { tools: [
                { name: 'search_customer', inputSchema: { type: 'object', properties: { name: { type: 'string' } } } },
            ] } }),
        }) as unknown as typeof fetch

        const { mcpGatewayService } = await import('../../../../src/app/mcp-gateway/mcp-gateway.service')
        const result = await mcpGatewayService(STUB_LOG).diffTools({
            id: GATEWAY_ID, platformId: PLATFORM_ID,
            tools: [{ name: 'search_customer', snapshot: { type: 'object', properties: { name: { type: 'string' } } } }],
        })
        expect(result.results[0]).toMatchObject({ name: 'search_customer', status: 'OK' })
    })

    it('marks tools as DRIFTED when snapshot differs from live schema', async () => {
        findOneMock.mockResolvedValue(record())
        decryptObjectMock.mockResolvedValue({ type: 'NONE' })
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async (): Promise<unknown> => ({ result: { tools: [
                { name: 'search_customer', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
            ] } }),
        }) as unknown as typeof fetch

        const { mcpGatewayService } = await import('../../../../src/app/mcp-gateway/mcp-gateway.service')
        const result = await mcpGatewayService(STUB_LOG).diffTools({
            id: GATEWAY_ID, platformId: PLATFORM_ID,
            tools: [{ name: 'search_customer', snapshot: { type: 'object', properties: { name: { type: 'string' } } } }],
        })
        expect(result.results[0]).toMatchObject({ name: 'search_customer', status: 'DRIFTED' })
    })

    it('marks missing tools as REMOVED', async () => {
        findOneMock.mockResolvedValue(record())
        decryptObjectMock.mockResolvedValue({ type: 'NONE' })
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async (): Promise<unknown> => ({ result: { tools: [
                { name: 'still_here' },
            ] } }),
        }) as unknown as typeof fetch

        const { mcpGatewayService } = await import('../../../../src/app/mcp-gateway/mcp-gateway.service')
        const result = await mcpGatewayService(STUB_LOG).diffTools({
            id: GATEWAY_ID, platformId: PLATFORM_ID,
            tools: [{ name: 'gone_forever', snapshot: {} }],
        })
        expect(result.results[0]).toMatchObject({ name: 'gone_forever', status: 'REMOVED' })
    })

    it('marks tools without snapshot as OK (no drift to compare)', async () => {
        findOneMock.mockResolvedValue(record())
        decryptObjectMock.mockResolvedValue({ type: 'NONE' })
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async (): Promise<unknown> => ({ result: { tools: [
                { name: 'x', inputSchema: { type: 'object' } },
            ] } }),
        }) as unknown as typeof fetch

        const { mcpGatewayService } = await import('../../../../src/app/mcp-gateway/mcp-gateway.service')
        const result = await mcpGatewayService(STUB_LOG).diffTools({
            id: GATEWAY_ID, platformId: PLATFORM_ID,
            tools: [{ name: 'x' }],
        })
        expect(result.results[0]).toMatchObject({ name: 'x', status: 'OK' })
    })
})
