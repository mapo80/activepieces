import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { outboxPublisher } from '../../../../src/app/ai/command-layer/outbox-publisher'
import { outboxService } from '../../../../src/app/ai/command-layer/outbox.service'
import { databaseConnection } from '../../../../src/app/database/database-connection'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

beforeAll(async () => {
    await setupTestEnvironment()
})
afterAll(async () => {
    await teardownTestEnvironment()
})

beforeEach(async () => {
    outboxPublisher.stop()
    const ds = databaseConnection()
    await ds.query('DELETE FROM "interactive_flow_outbox"')
    await ds.query('DELETE FROM "interactive_flow_session_sequence"')
})

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const stubLogger = (): never => ({
    warn: vi.fn(), error: vi.fn(), info: vi.fn(),
} as never)

describe('outbox publisher integration', () => {
    it('A-03.1: insertPending → markPublishable → claim returns batch → markPublished updates row', async () => {
        const turnId = `turn-${randomUUID()}`
        const inserted = await outboxService.insertPending({
            turnId,
            sessionId: `sess-${randomUUID()}`,
            flowRunId: 'run-pub-1',
            events: [{ eventType: 'TURN_COMMITTED', payload: { ok: true } }],
        })
        await outboxService.markPublishable({ turnId })

        const batch = await outboxService.claimNextSessionBatch({
            publisherId: 'pub-A',
            claimTtlSeconds: 30,
        })
        expect(batch.length).toBeGreaterThanOrEqual(1)
        expect(batch[0].outboxEventId).toBe(inserted[0].outboxEventId)
        expect(batch[0].eventType).toBe('TURN_COMMITTED')

        await outboxService.markPublished({ outboxEventId: batch[0].outboxEventId })
        const ds = databaseConnection()
        const row = await ds.query(
            'SELECT "publishedAt","claimedBy" FROM "interactive_flow_outbox" WHERE "outboxEventId" = $1',
            [batch[0].outboxEventId],
        )
        expect(row[0].publishedAt).not.toBeNull()
        expect(row[0].claimedBy).toBeNull()
    })

    it('A-03.1b: outboxPublisher.start picks up publishable rows and emits them', async () => {
        const turnId = `turn-${randomUUID()}`
        const inserted = await outboxService.insertPending({
            turnId,
            sessionId: `sess-${randomUUID()}`,
            flowRunId: 'run-pub-1b',
            events: [{ eventType: 'TURN_COMMITTED', payload: { ok: true } }],
        })
        await outboxService.markPublishable({ turnId })

        const emitted: Array<{ outboxEventId: string }> = []
        const emit = vi.fn(async (e: { outboxEventId: string }) => {
            emitted.push(e)
        })
        outboxPublisher.start({ log: stubLogger(), emit, pollIntervalMs: 50 })
        try {
            for (let i = 0; i < 40 && emitted.length === 0; i++) {
                await sleep(50)
            }
        }
        finally {
            outboxPublisher.stop()
        }
        expect(emitted.length).toBeGreaterThanOrEqual(1)
        expect(emitted.some((e) => e.outboxEventId === inserted[0].outboxEventId)).toBe(true)
    })

    it('A-03.2: emit failure → markRetry, attempts incremented', async () => {
        const turnId = `turn-${randomUUID()}`
        const inserted = await outboxService.insertPending({
            turnId,
            sessionId: `sess-${randomUUID()}`,
            flowRunId: 'run-pub-2',
            events: [{ eventType: 'TURN_COMMITTED', payload: {} }],
        })
        await outboxService.markPublishable({ turnId })

        let attempts = 0
        const emit = vi.fn(async () => {
            attempts++
            throw new Error('transient-fail')
        })
        outboxPublisher.start({ log: stubLogger(), emit, pollIntervalMs: 30 })
        try {
            await sleep(500)
        }
        finally {
            outboxPublisher.stop()
        }

        expect(attempts).toBeGreaterThanOrEqual(1)
        const ds = databaseConnection()
        const row = await ds.query(
            'SELECT "attempts","nextRetryAt" FROM "interactive_flow_outbox" WHERE "outboxEventId" = $1',
            [inserted[0].outboxEventId],
        )
        expect(Number(row[0].attempts)).toBeGreaterThanOrEqual(1)
    })

    it('A-03.3: claimNextSessionBatch returns at most one batch across two parallel claims', async () => {
        const turnId = `turn-${randomUUID()}`
        await outboxService.insertPending({
            turnId,
            sessionId: `sess-${randomUUID()}`,
            flowRunId: 'run-pub-3',
            events: [{ eventType: 'TURN_COMMITTED', payload: {} }],
        })
        await outboxService.markPublishable({ turnId })

        const [a, b] = await Promise.all([
            outboxService.claimNextSessionBatch({ publisherId: 'pub-A', claimTtlSeconds: 30 }),
            outboxService.claimNextSessionBatch({ publisherId: 'pub-B', claimTtlSeconds: 30 }),
        ])
        const totalClaimed = a.length + b.length
        expect(totalClaimed).toBeLessThanOrEqual(1)
    })

    it('A-03.4: empty publishable set → tick is a no-op', async () => {
        const emit = vi.fn()
        outboxPublisher.start({ log: stubLogger(), emit, pollIntervalMs: 30 })
        try {
            await sleep(120)
        }
        finally {
            outboxPublisher.stop()
        }
        expect(emit).not.toHaveBeenCalled()
    })
})
