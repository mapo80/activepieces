import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const claimNextSessionBatchMock = vi.fn()
const markPublishedMock = vi.fn()
const markRetryMock = vi.fn()
const recordOutboxPublishedMock = vi.fn()
const recordOutboxRetryMock = vi.fn()
const recordOutboxErrorMock = vi.fn()

vi.mock('../../../../src/app/ai/command-layer/outbox.service', () => ({
    outboxService: {
        claimNextSessionBatch: claimNextSessionBatchMock,
        markPublished: markPublishedMock,
        markRetry: markRetryMock,
    },
}))

vi.mock('../../../../src/app/ai/command-layer/metrics', () => ({
    commandLayerMetrics: {
        recordOutboxPublished: recordOutboxPublishedMock,
        recordOutboxRetry: recordOutboxRetryMock,
        recordOutboxError: recordOutboxErrorMock,
    },
}))

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const stubLogger = (): { warn: ReturnType<typeof vi.fn>, error: ReturnType<typeof vi.fn>, info: ReturnType<typeof vi.fn> } => ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
})

describe('outboxPublisher', () => {
    beforeEach(() => {
        claimNextSessionBatchMock.mockReset()
        markPublishedMock.mockReset()
        markRetryMock.mockReset()
        recordOutboxPublishedMock.mockReset()
        recordOutboxRetryMock.mockReset()
        recordOutboxErrorMock.mockReset()
    })

    afterEach(async () => {
        const { outboxPublisher } = await import('../../../../src/app/ai/command-layer/outbox-publisher')
        outboxPublisher.stop()
    })

    it('start() then tick claims batch, emits, marks published, records metrics', async () => {
        claimNextSessionBatchMock.mockResolvedValue([
            {
                outboxEventId: 'oe-1',
                turnId: 't-1',
                sessionId: 's-1',
                flowRunId: 'fr-1',
                sessionSequence: '1',
                eventType: 'TURN_STARTED',
                payload: { foo: 'bar' },
            },
        ])
        markPublishedMock.mockResolvedValue(undefined)
        const emit = vi.fn().mockResolvedValue(undefined)
        const log = stubLogger()
        const { outboxPublisher } = await import('../../../../src/app/ai/command-layer/outbox-publisher')
        outboxPublisher.start({ log: log as never, emit, pollIntervalMs: 20 })
        await sleep(80)
        expect(emit).toHaveBeenCalledWith(expect.objectContaining({ outboxEventId: 'oe-1', eventType: 'TURN_STARTED' }))
        expect(markPublishedMock).toHaveBeenCalledWith({ outboxEventId: 'oe-1' })
        expect(recordOutboxPublishedMock).toHaveBeenCalledWith({ eventType: 'TURN_STARTED' })
    })

    it('start() is idempotent: second start before stop is a no-op', async () => {
        claimNextSessionBatchMock.mockResolvedValue([])
        const log = stubLogger()
        const { outboxPublisher } = await import('../../../../src/app/ai/command-layer/outbox-publisher')
        outboxPublisher.start({ log: log as never, emit: vi.fn(), pollIntervalMs: 5_000 })
        outboxPublisher.start({ log: log as never, emit: vi.fn(), pollIntervalMs: 5_000 })
        expect(log.info).toHaveBeenCalledTimes(1)
    })

    it('emit throws → markRetry called with eventType, metric records retry', async () => {
        claimNextSessionBatchMock.mockResolvedValueOnce([
            {
                outboxEventId: 'oe-2',
                turnId: 't-2',
                sessionId: 's-2',
                flowRunId: 'fr-2',
                sessionSequence: '1',
                eventType: 'TURN_FAILED',
                payload: {},
            },
        ]).mockResolvedValue([])
        markRetryMock.mockResolvedValue({ dead: false })
        const emit = vi.fn().mockRejectedValueOnce(new Error('ws-down'))
        const log = stubLogger()
        const { outboxPublisher } = await import('../../../../src/app/ai/command-layer/outbox-publisher')
        outboxPublisher.start({ log: log as never, emit, pollIntervalMs: 20 })
        await sleep(80)
        expect(markRetryMock).toHaveBeenCalledWith(expect.objectContaining({ outboxEventId: 'oe-2' }))
        expect(recordOutboxRetryMock).toHaveBeenCalledWith({ eventType: 'TURN_FAILED', dead: false })
        expect(log.warn).toHaveBeenCalled()
    })

    it('emit throws + markRetry returns dead → records dead metric', async () => {
        claimNextSessionBatchMock.mockResolvedValueOnce([
            {
                outboxEventId: 'oe-3',
                turnId: 't-3',
                sessionId: 's-3',
                flowRunId: 'fr-3',
                sessionSequence: '1',
                eventType: 'TURN_FAILED',
                payload: {},
            },
        ]).mockResolvedValue([])
        markRetryMock.mockResolvedValue({ dead: true })
        const emit = vi.fn().mockRejectedValueOnce(new Error('boom'))
        const log = stubLogger()
        const { outboxPublisher } = await import('../../../../src/app/ai/command-layer/outbox-publisher')
        outboxPublisher.start({ log: log as never, emit, pollIntervalMs: 20 })
        await sleep(80)
        expect(recordOutboxRetryMock).toHaveBeenCalledWith({ eventType: 'TURN_FAILED', dead: true })
    })

    it('claimNextSessionBatch throws → records error metric and logs', async () => {
        claimNextSessionBatchMock.mockRejectedValueOnce(new Error('db-down')).mockResolvedValue([])
        const log = stubLogger()
        const { outboxPublisher } = await import('../../../../src/app/ai/command-layer/outbox-publisher')
        outboxPublisher.start({ log: log as never, emit: vi.fn(), pollIntervalMs: 20 })
        await sleep(80)
        expect(recordOutboxErrorMock).toHaveBeenCalled()
        expect(log.error).toHaveBeenCalled()
    })

    it('empty batch → no emit, no markPublished', async () => {
        claimNextSessionBatchMock.mockResolvedValue([])
        const emit = vi.fn()
        const log = stubLogger()
        const { outboxPublisher } = await import('../../../../src/app/ai/command-layer/outbox-publisher')
        outboxPublisher.start({ log: log as never, emit, pollIntervalMs: 20 })
        await sleep(80)
        expect(claimNextSessionBatchMock).toHaveBeenCalled()
        expect(emit).not.toHaveBeenCalled()
        expect(markPublishedMock).not.toHaveBeenCalled()
    })

    it('stop() clears interval; subsequent ticks do not run', async () => {
        claimNextSessionBatchMock.mockResolvedValue([])
        const log = stubLogger()
        const { outboxPublisher } = await import('../../../../src/app/ai/command-layer/outbox-publisher')
        outboxPublisher.start({ log: log as never, emit: vi.fn(), pollIntervalMs: 20 })
        await sleep(40)
        outboxPublisher.stop()
        const callsBefore = claimNextSessionBatchMock.mock.calls.length
        await sleep(80)
        expect(claimNextSessionBatchMock.mock.calls.length).toBe(callsBefore)
    })

    it('uses provided pollIntervalMs (smoke check, not default)', async () => {
        claimNextSessionBatchMock.mockResolvedValue([])
        const log = stubLogger()
        const { outboxPublisher } = await import('../../../../src/app/ai/command-layer/outbox-publisher')
        outboxPublisher.start({ log: log as never, emit: vi.fn(), pollIntervalMs: 20 })
        await sleep(80)
        expect(claimNextSessionBatchMock.mock.calls.length).toBeGreaterThanOrEqual(2)
    })

    it('tick after stop short-circuits via early-return guard', async () => {
        let captured: (() => void) | null = null
        const handle = { unref: undefined as unknown as () => void } as unknown as ReturnType<typeof setInterval>
        const setIntervalSpy = vi.spyOn(global, 'setInterval').mockImplementation((cb: never) => {
            captured = cb
            return handle
        })
        const clearIntervalSpy = vi.spyOn(global, 'clearInterval').mockImplementation(() => undefined)
        try {
            claimNextSessionBatchMock.mockResolvedValue([])
            const log = stubLogger()
            const { outboxPublisher } = await import('../../../../src/app/ai/command-layer/outbox-publisher')
            outboxPublisher.start({ log: log as never, emit: vi.fn(), pollIntervalMs: 1_000 })
            outboxPublisher.stop()
            expect(captured).not.toBeNull()
            captured?.()
            await sleep(20)
            expect(claimNextSessionBatchMock).not.toHaveBeenCalled()
        }
        finally {
            setIntervalSpy.mockRestore()
            clearIntervalSpy.mockRestore()
        }
    })
})
