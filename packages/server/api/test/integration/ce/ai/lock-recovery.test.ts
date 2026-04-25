import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const reclaimStaleLocksMock = vi.fn()
const recordStaleReclaimMock = vi.fn()
const recordStaleReclaimErrorMock = vi.fn()
const databaseConnectionMock = vi.fn(() => ({} as never))

vi.mock('../../../../src/app/ai/command-layer/turn-log.service', () => ({
    turnLogService: {
        reclaimStaleLocks: reclaimStaleLocksMock,
    },
}))

vi.mock('../../../../src/app/ai/command-layer/metrics', () => ({
    commandLayerMetrics: {
        recordStaleReclaim: recordStaleReclaimMock,
        recordStaleReclaimError: recordStaleReclaimErrorMock,
    },
}))

vi.mock('../../../../src/app/database/database-connection', () => ({
    databaseConnection: databaseConnectionMock,
}))

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const stubLogger = (): { error: ReturnType<typeof vi.fn>, info: ReturnType<typeof vi.fn> } => ({
    error: vi.fn(),
    info: vi.fn(),
})

describe('lockRecoveryDaemon', () => {
    beforeEach(() => {
        reclaimStaleLocksMock.mockReset()
        recordStaleReclaimMock.mockReset()
        recordStaleReclaimErrorMock.mockReset()
    })

    afterEach(async () => {
        const { lockRecoveryDaemon } = await import('../../../../src/app/ai/command-layer/lock-recovery')
        lockRecoveryDaemon.stop()
    })

    it('start() then tick reclaims stale locks and records metric', async () => {
        reclaimStaleLocksMock.mockResolvedValueOnce(3).mockResolvedValue(0)
        const log = stubLogger()
        const { lockRecoveryDaemon } = await import('../../../../src/app/ai/command-layer/lock-recovery')
        lockRecoveryDaemon.start({ log: log as never, pollIntervalMs: 20 })
        await sleep(80)
        expect(reclaimStaleLocksMock).toHaveBeenCalled()
        expect(recordStaleReclaimMock).toHaveBeenCalledWith({ count: 3 })
        expect(log.info).toHaveBeenCalledWith({ reclaimed: 3 }, expect.any(String))
    })

    it('tick with reclaimed=0 does not record metric or log info-reclaimed', async () => {
        reclaimStaleLocksMock.mockResolvedValue(0)
        const log = stubLogger()
        const { lockRecoveryDaemon } = await import('../../../../src/app/ai/command-layer/lock-recovery')
        lockRecoveryDaemon.start({ log: log as never, pollIntervalMs: 20 })
        await sleep(80)
        expect(recordStaleReclaimMock).not.toHaveBeenCalled()
    })

    it('reclaim throws → records error metric and logs', async () => {
        reclaimStaleLocksMock.mockRejectedValueOnce(new Error('db-down')).mockResolvedValue(0)
        const log = stubLogger()
        const { lockRecoveryDaemon } = await import('../../../../src/app/ai/command-layer/lock-recovery')
        lockRecoveryDaemon.start({ log: log as never, pollIntervalMs: 20 })
        await sleep(80)
        expect(recordStaleReclaimErrorMock).toHaveBeenCalled()
        expect(log.error).toHaveBeenCalled()
    })

    it('start() is idempotent: second call before stop is a no-op', async () => {
        reclaimStaleLocksMock.mockResolvedValue(0)
        const log = stubLogger()
        const { lockRecoveryDaemon } = await import('../../../../src/app/ai/command-layer/lock-recovery')
        lockRecoveryDaemon.start({ log: log as never, pollIntervalMs: 5_000 })
        lockRecoveryDaemon.start({ log: log as never, pollIntervalMs: 5_000 })
        expect(log.info).toHaveBeenCalledTimes(1)
    })

    it('stop() prevents subsequent ticks', async () => {
        reclaimStaleLocksMock.mockResolvedValue(0)
        const log = stubLogger()
        const { lockRecoveryDaemon } = await import('../../../../src/app/ai/command-layer/lock-recovery')
        lockRecoveryDaemon.start({ log: log as never, pollIntervalMs: 20 })
        await sleep(40)
        lockRecoveryDaemon.stop()
        const before = reclaimStaleLocksMock.mock.calls.length
        await sleep(80)
        expect(reclaimStaleLocksMock.mock.calls.length).toBe(before)
    })

    it('uses provided pollIntervalMs', async () => {
        reclaimStaleLocksMock.mockResolvedValue(0)
        const log = stubLogger()
        const { lockRecoveryDaemon } = await import('../../../../src/app/ai/command-layer/lock-recovery')
        lockRecoveryDaemon.start({ log: log as never, pollIntervalMs: 20 })
        await sleep(80)
        expect(reclaimStaleLocksMock.mock.calls.length).toBeGreaterThanOrEqual(2)
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
            reclaimStaleLocksMock.mockResolvedValue(0)
            const log = stubLogger()
            const { lockRecoveryDaemon } = await import('../../../../src/app/ai/command-layer/lock-recovery')
            lockRecoveryDaemon.start({ log: log as never, pollIntervalMs: 1_000 })
            lockRecoveryDaemon.stop()
            expect(captured).not.toBeNull()
            captured?.()
            await sleep(20)
            expect(reclaimStaleLocksMock).not.toHaveBeenCalled()
        }
        finally {
            setIntervalSpy.mockRestore()
            clearIntervalSpy.mockRestore()
        }
    })
})
