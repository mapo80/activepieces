import { ActivepiecesError, ErrorCode } from '@activepieces/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getConfigMock = vi.fn()

vi.mock('../../../../src/app/ai/ai-provider-service', () => ({
    aiProviderService: (): { getConfigOrThrow: typeof getConfigMock } => ({
        getConfigOrThrow: getConfigMock,
    }),
}))

vi.mock('../../../../src/app/core/security/authorization/fastify-security', () => ({
    securityAccess: {
        engine: (): Record<string, never> => ({}),
    },
}))

async function runHandler(request: {
    params: { provider: string }
    principal: { platform: { id: string } | undefined }
    log: Record<string, unknown>
}): Promise<unknown> {
    const { aiProviderWorkerController } = await import('../../../../src/app/ai/ai-provider-worker.controller')
    let handler: ((r: unknown) => Promise<unknown>) | undefined
    const appStub = {
        get: (_path: string, _opts: unknown, fn: (r: unknown) => Promise<unknown>) => {
            handler = fn
        },
    } as unknown as Parameters<typeof aiProviderWorkerController>[0]
    await aiProviderWorkerController(appStub, {})
    if (!handler) throw new Error('handler not registered')
    return handler(request)
}

const PLATFORM_ID = 'pf1234567890123456789'
const STUB_LOG = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), trace: vi.fn(), child: vi.fn(), silent: vi.fn(), level: 'info' }

describe('aiProviderWorkerController', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.resetModules()
    })

    it('returns { provider, auth, config } for a configured provider', async () => {
        getConfigMock.mockResolvedValueOnce({ auth: { apiKey: 'sk-test' }, config: {} })
        const result = await runHandler({
            params: { provider: 'openai' },
            principal: { platform: { id: PLATFORM_ID } },
            log: STUB_LOG,
        })
        expect(getConfigMock).toHaveBeenCalledWith({ platformId: PLATFORM_ID, provider: 'openai' })
        expect(result).toEqual({ provider: 'openai', auth: { apiKey: 'sk-test' }, config: {} })
    })

    it('propagates ENTITY_NOT_FOUND when the provider is not configured', async () => {
        getConfigMock.mockRejectedValueOnce(new ActivepiecesError({
            code: ErrorCode.ENTITY_NOT_FOUND,
            params: { entityId: 'openai', entityType: 'AIProvider' },
        }))
        await expect(runHandler({
            params: { provider: 'openai' },
            principal: { platform: { id: PLATFORM_ID } },
            log: STUB_LOG,
        })).rejects.toMatchObject({ error: { code: ErrorCode.ENTITY_NOT_FOUND } })
    })

    it('throws when principal has no platformId', async () => {
        await expect(runHandler({
            params: { provider: 'openai' },
            principal: { platform: undefined },
            log: STUB_LOG,
        })).rejects.toThrow(/platformId/)
    })
})
