import { ActivepiecesError, ErrorCode, McpGatewayAuth } from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

async function expectThrows(fn: () => Promise<unknown>, code: ErrorCode, messageMatcher?: RegExp): Promise<void> {
    try {
        await fn()
    }
    catch (err) {
        expect(err).toBeInstanceOf(ActivepiecesError)
        const ape = err as ActivepiecesError
        expect(ape.error.code).toBe(code)
        if (messageMatcher) {
            const params = ape.error.params as { message?: string }
            expect(params.message ?? '').toMatch(messageMatcher)
        }
        return
    }
    throw new Error(`Expected function to throw ${code}`)
}

const insertMock = vi.fn()
const findMock = vi.fn()
const findOneMock = vi.fn()
const updateMock = vi.fn()
const deleteMock = vi.fn()

vi.mock('../../../../src/app/core/db/repo-factory', () => ({
    repoFactory: () => () => ({
        insert: insertMock,
        find: findMock,
        findOne: findOneMock,
        update: updateMock,
        delete: deleteMock,
    }),
}))

const encryptObjectMock = vi.fn()
const decryptObjectMock = vi.fn()

vi.mock('../../../../src/app/helper/encryption', () => ({
    encryptUtils: {
        encryptObject: (o: unknown) => encryptObjectMock(o),
        decryptObject: <T>(o: unknown) => decryptObjectMock(o) as Promise<T>,
    },
    EncryptedObject: {},
}))

const apIdMock = vi.fn()
vi.mock('@activepieces/shared', async () => {
    const actual = await vi.importActual<typeof import('@activepieces/shared')>('@activepieces/shared')
    return {
        ...actual,
        apId: () => apIdMock(),
    }
})

const mockLog = {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    fatal: vi.fn(), trace: vi.fn(), child: vi.fn(), silent: vi.fn(), level: 'info',
} as unknown as FastifyBaseLogger

type McpGatewayService = ReturnType<typeof import('../../../../src/app/mcp-gateway/mcp-gateway.service').mcpGatewayService>

async function loadService(): Promise<McpGatewayService> {
    const { mcpGatewayService } = await import('../../../../src/app/mcp-gateway/mcp-gateway.service')
    return mcpGatewayService(mockLog)
}

const PLATFORM_ID = 'abc123DEF456ghi789JKL'
const GATEWAY_ID = 'qrs234TUV567wxy890ZAB'
const now = new Date().toISOString()
const encryptedAuth = { iv: 'iv', data: 'data' }

function record(overrides: Record<string, unknown> = {}) {
    return {
        id: GATEWAY_ID,
        created: now,
        updated: now,
        platformId: PLATFORM_ID,
        name: 'Banking',
        url: 'https://gateway.example/rpc',
        description: null,
        auth: encryptedAuth,
        ...overrides,
    }
}

describe('mcpGatewayService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        apIdMock.mockReturnValue(GATEWAY_ID)
        encryptObjectMock.mockResolvedValue(encryptedAuth)
        decryptObjectMock.mockResolvedValue({ type: 'BEARER', token: 'secret-tok' })
        findMock.mockResolvedValue([])
        findOneMock.mockResolvedValue(null)
        insertMock.mockResolvedValue(undefined)
        updateMock.mockResolvedValue(undefined)
        deleteMock.mockResolvedValue({ affected: 1 })
    })
    afterEach(() => {
        vi.resetModules()
    })

    it('create inserts an encrypted record and returns the public view', async () => {
        findOneMock
            .mockResolvedValueOnce(null) // uniqueness check
            .mockResolvedValueOnce(record()) // getOrThrow after insert

        const service = await loadService()
        const result = await service.create({
            platformId: PLATFORM_ID,
            request: {
                name: 'Banking',
                url: 'https://gateway.example/rpc',
                auth: { type: 'BEARER', token: 'secret-tok' },
            },
        })

        expect(encryptObjectMock).toHaveBeenCalledWith({ type: 'BEARER', token: 'secret-tok' })
        expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
            id: GATEWAY_ID,
            platformId: PLATFORM_ID,
            name: 'Banking',
            url: 'https://gateway.example/rpc',
            description: null,
            auth: encryptedAuth,
        }))
        expect(result.auth).toEqual({ type: 'BEARER' })
        expect((result.auth as McpGatewayAuth & { token?: string }).token).toBeUndefined()
    })

    it('create rejects when a gateway with the same name already exists', async () => {
        findOneMock.mockResolvedValueOnce(record())

        const service = await loadService()
        await expectThrows(() => service.create({
            platformId: PLATFORM_ID,
            request: {
                name: 'Banking',
                url: 'https://gateway.example/rpc',
                auth: { type: 'NONE' },
            },
        }), ErrorCode.VALIDATION, /already exists/)
        expect(insertMock).not.toHaveBeenCalled()
    })

    it('list decrypts and strips secrets for every record', async () => {
        findMock.mockResolvedValueOnce([record(), record({ id: 'aaa000111222333444555', name: 'CRM' })])
        decryptObjectMock
            .mockResolvedValueOnce({ type: 'BEARER', token: 'tok' })
            .mockResolvedValueOnce({ type: 'API_KEY', headerName: 'X-K', key: 'kk' })

        const service = await loadService()
        const result = await service.list({ platformId: PLATFORM_ID })

        expect(result).toHaveLength(2)
        expect(result[0].auth).toEqual({ type: 'BEARER' })
        expect(result[1].auth).toEqual({ type: 'API_KEY', headerName: 'X-K' })
    })

    it('get returns the public view of a single gateway', async () => {
        findOneMock.mockResolvedValueOnce(record())
        const service = await loadService()
        const got = await service.get({ id: GATEWAY_ID, platformId: PLATFORM_ID })
        expect(got.id).toBe(GATEWAY_ID)
        expect(got.auth).toEqual({ type: 'BEARER' })
    })

    it('get throws ENTITY_NOT_FOUND when the gateway does not exist', async () => {
        findOneMock.mockResolvedValueOnce(null)
        const service = await loadService()
        await expectThrows(() => service.get({ id: GATEWAY_ID, platformId: PLATFORM_ID }), ErrorCode.ENTITY_NOT_FOUND)
    })

    it('update re-encrypts auth when provided and keeps existing otherwise', async () => {
        findOneMock
            .mockResolvedValueOnce(record()) // existing
            .mockResolvedValueOnce(record({ url: 'https://new.example/rpc' })) // post-update read
        encryptObjectMock.mockResolvedValue({ iv: 'iv2', data: 'data2' })

        const service = await loadService()
        await service.update({
            id: GATEWAY_ID,
            platformId: PLATFORM_ID,
            request: { url: 'https://new.example/rpc' },
        })

        expect(updateMock).toHaveBeenCalledWith(
            { id: GATEWAY_ID, platformId: PLATFORM_ID },
            expect.objectContaining({
                url: 'https://new.example/rpc',
                auth: encryptedAuth, // kept as the existing one
            }),
        )
    })

    it('update rejects rename that clashes with another gateway', async () => {
        findOneMock
            .mockResolvedValueOnce(record({ name: 'Banking' })) // existing
            .mockResolvedValueOnce(record({ id: 'other00111222333444556', name: 'CRM' })) // uniqueness check hits other row

        const service = await loadService()
        await expectThrows(() => service.update({
            id: GATEWAY_ID,
            platformId: PLATFORM_ID,
            request: { name: 'CRM' },
        }), ErrorCode.VALIDATION, /already exists/)
    })

    it('delete removes the record when present', async () => {
        const service = await loadService()
        await service.delete({ id: GATEWAY_ID, platformId: PLATFORM_ID })
        expect(deleteMock).toHaveBeenCalledWith({ id: GATEWAY_ID, platformId: PLATFORM_ID })
    })

    it('delete throws ENTITY_NOT_FOUND when no row is deleted', async () => {
        deleteMock.mockResolvedValueOnce({ affected: 0 })
        const service = await loadService()
        await expectThrows(() => service.delete({ id: GATEWAY_ID, platformId: PLATFORM_ID }), ErrorCode.ENTITY_NOT_FOUND)
    })

    it('getResolved returns decrypted credentials', async () => {
        findOneMock.mockResolvedValueOnce(record())
        const service = await loadService()
        const resolved = await service.getResolved({ id: GATEWAY_ID, platformId: PLATFORM_ID })
        expect(resolved.auth).toEqual({ type: 'BEARER', token: 'secret-tok' })
    })

    describe('listTools', () => {
        const originalFetch = globalThis.fetch

        afterEach(() => {
            globalThis.fetch = originalFetch
        })

        it('calls the gateway with JSON-RPC tools/list and normalizes the response', async () => {
            findOneMock.mockResolvedValue(record())
            decryptObjectMock.mockResolvedValue({ type: 'BEARER', token: 'tok' })
            const fetchMock = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({
                    jsonrpc: '2.0',
                    id: 1,
                    result: {
                        tools: [
                            { name: 'search', description: 'd', inputSchema: { type: 'object' } },
                            { name: 'add' },
                            { name: '' }, // filtered out
                        ],
                    },
                }),
            })
            globalThis.fetch = fetchMock as unknown as typeof fetch

            const service = await loadService()
            const out = await service.listTools({ id: GATEWAY_ID, platformId: PLATFORM_ID })

            expect(out.tools.map(t => t.name)).toEqual(['search', 'add'])
            const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
            expect(JSON.parse(String(init.body))).toMatchObject({ method: 'tools/list' })
            expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
        })

        it('caches consecutive calls for the same gateway id', async () => {
            findOneMock.mockResolvedValue(record())
            decryptObjectMock.mockResolvedValue({ type: 'NONE' })
            const fetchMock = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ result: { tools: [{ name: 'only-once' }] } }),
            })
            globalThis.fetch = fetchMock as unknown as typeof fetch

            const service = await loadService()
            await service.listTools({ id: GATEWAY_ID, platformId: PLATFORM_ID })
            await service.listTools({ id: GATEWAY_ID, platformId: PLATFORM_ID })

            expect(fetchMock).toHaveBeenCalledTimes(1)
        })

        it('wraps fetch errors as VALIDATION', async () => {
            findOneMock.mockResolvedValue(record({ id: 'unreach1111222233334445' }))
            decryptObjectMock.mockResolvedValue({ type: 'NONE' })
            globalThis.fetch = (async () => { throw new Error('boom') }) as unknown as typeof fetch

            const service = await loadService()
            await expectThrows(() => service.listTools({
                id: 'unreach1111222233334445',
                platformId: PLATFORM_ID,
            }), ErrorCode.VALIDATION, /unreachable/)
        })

        it('rejects non-2xx gateway responses', async () => {
            findOneMock.mockResolvedValue(record({ id: 'status1111222233334445X' }))
            decryptObjectMock.mockResolvedValue({ type: 'NONE' })
            globalThis.fetch = (async () => ({
                ok: false,
                status: 500,
                json: async () => ({}),
            })) as unknown as typeof fetch

            const service = await loadService()
            await expectThrows(() => service.listTools({
                id: 'status1111222233334445X',
                platformId: PLATFORM_ID,
            }), ErrorCode.VALIDATION, /HTTP 500/)
        })

        it('rejects malformed tool list payloads', async () => {
            findOneMock.mockResolvedValue(record({ id: 'malformed11122223333444' }))
            decryptObjectMock.mockResolvedValue({ type: 'API_KEY', headerName: 'X-K', key: 'kk' })
            globalThis.fetch = (async () => ({
                ok: true,
                status: 200,
                json: async () => ({ result: 'not-an-object' }),
            })) as unknown as typeof fetch

            const service = await loadService()
            await expectThrows(() => service.listTools({
                id: 'malformed11122223333444',
                platformId: PLATFORM_ID,
            }), ErrorCode.VALIDATION, /invalid tools\/list/i)
        })

        it('sends custom HEADER auth when configured', async () => {
            findOneMock.mockResolvedValue(record({ id: 'custom11122223333444555' }))
            decryptObjectMock.mockResolvedValue({ type: 'HEADER', headerName: 'X-Custom', headerValue: 'v' })
            const fetchMock = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                json: async () => ({ result: { tools: [{ name: 'x' }] } }),
            })
            globalThis.fetch = fetchMock as unknown as typeof fetch

            const service = await loadService()
            await service.listTools({ id: 'custom11122223333444555', platformId: PLATFORM_ID })

            const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
            expect((init.headers as Record<string, string>)['X-Custom']).toBe('v')
        })
    })
})
