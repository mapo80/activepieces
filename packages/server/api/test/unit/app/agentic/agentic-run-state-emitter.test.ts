import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@activepieces/server-utils', () => ({
    safeHttp: { axios: { post: vi.fn() } },
}))

import { agenticRunStateEmitter, RunStatePayload } from '../../../../src/app/agentic/agentic-run-state-emitter'
import { safeHttp } from '@activepieces/server-utils'

const SECRET = 'oos-d2-test-secret'
const URL = 'http://java.example.com:8090'
const FAST_TIMEOUT = 100

function buildLogger(): { info: ReturnType<typeof vi.fn>, warn: ReturnType<typeof vi.fn>, error: ReturnType<typeof vi.fn>, debug: ReturnType<typeof vi.fn> } {
    return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}

function buildPayload(overrides: Partial<RunStatePayload> = {}): RunStatePayload {
    return {
        platformRunId: 'ap-run-1',
        runVersion: 1,
        runState: 'PAUSED',
        eventEpoch: Date.now(),
        timestamp: new Date().toISOString(),
        ...overrides,
    }
}

describe('agenticRunStateEmitter', () => {
    beforeEach(() => {
        vi.mocked(safeHttp.axios.post).mockReset()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('delivers PAUSED with HMAC sha256 signature header', async () => {
        vi.mocked(safeHttp.axios.post).mockResolvedValueOnce({ status: 202 })
        const log = buildLogger()
        const emitter = agenticRunStateEmitter({ log, pushUrl: URL, secret: SECRET, maxAttempts: 1 })

        const outcome = await emitter.emit(buildPayload())

        expect(outcome.delivered).toBe(true)
        expect(outcome.status).toBe(202)
        const call = vi.mocked(safeHttp.axios.post).mock.calls[0]
        expect(call[0]).toBe(`${URL}/agentic/v1/webhooks/run-state`)
        expect(call[2]?.headers?.['X-AP-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/)
        expect(call[2]?.headers?.['Content-Type']).toBe('application/json')
    })

    it.each(['PAUSED', 'SUCCEEDED', 'FAILED', 'CANCELED'] as const)('emits POST on %s state', async (state) => {
        vi.mocked(safeHttp.axios.post).mockResolvedValueOnce({ status: 202 })
        const log = buildLogger()
        const emitter = agenticRunStateEmitter({ log, pushUrl: URL, secret: SECRET, maxAttempts: 1 })

        const outcome = await emitter.emit(buildPayload({ runState: state }))

        expect(outcome.delivered).toBe(true)
        expect(safeHttp.axios.post).toHaveBeenCalledTimes(1)
    })

    it.each(['RUNNING', 'QUEUED', 'TIMEOUT', 'OTHER'])('skips non-tracked state %s without POST', async (state) => {
        const log = buildLogger()
        const emitter = agenticRunStateEmitter({ log, pushUrl: URL, secret: SECRET })

        const outcome = await emitter.emit(buildPayload({ runState: state as RunStatePayload['runState'] }))

        expect(outcome.delivered).toBe(false)
        expect(outcome.reason).toBe('state-not-tracked')
        expect(safeHttp.axios.post).not.toHaveBeenCalled()
    })

    it('produces deterministic HMAC signature for known body+secret', async () => {
        const knownPayload: RunStatePayload = {
            platformRunId: 'ap-known',
            runVersion: 7,
            runState: 'SUCCEEDED',
            eventEpoch: 1700000000000,
            timestamp: '2026-05-02T10:00:00.000Z',
        }
        const expectedBody = JSON.stringify(knownPayload)
        const { createHmac } = await import('node:crypto')
        const expectedSig = `sha256=${createHmac('sha256', SECRET).update(expectedBody).digest('hex')}`

        vi.mocked(safeHttp.axios.post).mockResolvedValueOnce({ status: 202 })
        const log = buildLogger()
        const emitter = agenticRunStateEmitter({ log, pushUrl: URL, secret: SECRET, maxAttempts: 1 })

        await emitter.emit(knownPayload)

        const call = vi.mocked(safeHttp.axios.post).mock.calls[0]
        expect(call[1]).toBe(expectedBody)
        expect(call[2]?.headers?.['X-AP-Signature']).toBe(expectedSig)
    })

    it('retries on 503 then succeeds on 4th attempt', async () => {
        vi.mocked(safeHttp.axios.post)
            .mockResolvedValueOnce({ status: 503 })
            .mockResolvedValueOnce({ status: 503 })
            .mockResolvedValueOnce({ status: 202 })
        const log = buildLogger()
        const emitter = agenticRunStateEmitter({ log, pushUrl: URL, secret: SECRET, maxAttempts: 3, timeoutMs: FAST_TIMEOUT })

        const outcome = await emitter.emit(buildPayload())

        expect(outcome.delivered).toBe(true)
        expect(outcome.attempts).toBe(3)
        expect(safeHttp.axios.post).toHaveBeenCalledTimes(3)
    })

    it('retries on network error then succeeds', async () => {
        vi.mocked(safeHttp.axios.post)
            .mockRejectedValueOnce(new Error('ECONNREFUSED'))
            .mockResolvedValueOnce({ status: 202 })
        const log = buildLogger()
        const emitter = agenticRunStateEmitter({ log, pushUrl: URL, secret: SECRET, maxAttempts: 2, timeoutMs: FAST_TIMEOUT })

        const outcome = await emitter.emit(buildPayload())

        expect(outcome.delivered).toBe(true)
        expect(outcome.attempts).toBe(2)
    })

    it('does NOT retry on 4xx response', async () => {
        vi.mocked(safeHttp.axios.post).mockResolvedValueOnce({ status: 401 })
        const log = buildLogger()
        const emitter = agenticRunStateEmitter({ log, pushUrl: URL, secret: SECRET, maxAttempts: 3 })

        const outcome = await emitter.emit(buildPayload())

        expect(outcome.delivered).toBe(false)
        expect(outcome.reason).toBe('client-error')
        expect(outcome.status).toBe(401)
        expect(safeHttp.axios.post).toHaveBeenCalledTimes(1)
    })

    it('returns retries-exhausted outcome after all attempts fail', async () => {
        vi.mocked(safeHttp.axios.post).mockRejectedValue(new Error('connection lost'))
        const log = buildLogger()
        const emitter = agenticRunStateEmitter({ log, pushUrl: URL, secret: SECRET, maxAttempts: 3, timeoutMs: FAST_TIMEOUT })

        const outcome = await emitter.emit(buildPayload())

        expect(outcome.delivered).toBe(false)
        expect(outcome.reason).toBe('retries-exhausted')
        expect(outcome.attempts).toBe(3)
        expect(log.error).toHaveBeenCalled()
    })

    it('skips emission when AGENTIC_PUSH_URL missing', async () => {
        const log = buildLogger()
        const emitter = agenticRunStateEmitter({ log, pushUrl: undefined, secret: SECRET })

        const outcome = await emitter.emit(buildPayload())

        expect(outcome.delivered).toBe(false)
        expect(outcome.reason).toBe('push-url-missing')
        expect(safeHttp.axios.post).not.toHaveBeenCalled()
    })

    it('logs warn and skips emission when secret missing', async () => {
        const log = buildLogger()
        const emitter = agenticRunStateEmitter({ log, pushUrl: URL, secret: undefined })

        const outcome = await emitter.emit(buildPayload())

        expect(outcome.delivered).toBe(false)
        expect(outcome.reason).toBe('secret-missing')
        expect(log.warn).toHaveBeenCalled()
        expect(safeHttp.axios.post).not.toHaveBeenCalled()
    })

    it('strips trailing slash from pushUrl when constructing endpoint', async () => {
        vi.mocked(safeHttp.axios.post).mockResolvedValueOnce({ status: 202 })
        const log = buildLogger()
        const emitter = agenticRunStateEmitter({ log, pushUrl: `${URL}//`, secret: SECRET, maxAttempts: 1 })

        await emitter.emit(buildPayload())

        const call = vi.mocked(safeHttp.axios.post).mock.calls[0]
        expect(call[0]).toBe(`${URL}/agentic/v1/webhooks/run-state`)
    })

    it('preserves data + tenant + project payload fields in body', async () => {
        vi.mocked(safeHttp.axios.post).mockResolvedValueOnce({ status: 202 })
        const log = buildLogger()
        const emitter = agenticRunStateEmitter({ log, pushUrl: URL, secret: SECRET, maxAttempts: 1 })

        const payload: RunStatePayload = {
            platformRunId: 'ap-run-data',
            runVersion: 5,
            runState: 'SUCCEEDED',
            eventEpoch: 9000000000,
            tenantId: 'tenant-bank',
            projectId: 'proj-1',
            data: { submissionRef: 'ES-2026-0001', terminalAt: '2026-05-02T10:00:00Z' },
            timestamp: '2026-05-02T10:00:00.000Z',
        }
        await emitter.emit(payload)

        const call = vi.mocked(safeHttp.axios.post).mock.calls[0]
        const sentBody = JSON.parse(String(call[1])) as Record<string, unknown>
        expect(sentBody.platformRunId).toBe('ap-run-data')
        expect(sentBody.tenantId).toBe('tenant-bank')
        expect(sentBody.projectId).toBe('proj-1')
        expect(sentBody.data).toEqual({ submissionRef: 'ES-2026-0001', terminalAt: '2026-05-02T10:00:00Z' })
    })

    it('respects 5s default timeout', async () => {
        vi.mocked(safeHttp.axios.post).mockResolvedValueOnce({ status: 202 })
        const log = buildLogger()
        const emitter = agenticRunStateEmitter({ log, pushUrl: URL, secret: SECRET, maxAttempts: 1 })

        await emitter.emit(buildPayload())

        const call = vi.mocked(safeHttp.axios.post).mock.calls[0]
        expect(call[2]?.timeout).toBe(5000)
    })
})
