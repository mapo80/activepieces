import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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
    const ds = databaseConnection()
    await ds.query('DELETE FROM "interactive_flow_outbox"')
    await ds.query('DELETE FROM "interactive_flow_session_sequence"')
    await ds.query('DELETE FROM "interactive_flow_turn_log"')
})

async function seedPublishable({ sessionId, count }: { sessionId: string, count: number }): Promise<string[]> {
    const events = Array.from({ length: count }, (_, i) => ({
        eventType: `EVENT_${i}`,
        payload: { i, sessionId },
    }))
    const inserted = await outboxService.insertPending({
        turnId: `turn-${sessionId}-${Date.now()}`,
        sessionId,
        flowRunId: `run-${sessionId}`,
        events,
    })
    await outboxService.markPublishable({ turnId: inserted[0].turnId })
    return inserted.map(e => e.sessionSequence)
}

describe('command-layer outbox replay', () => {
    it('A-05.1: replay returns all publishable events when afterSequence=0', async () => {
        const sequences = await seedPublishable({ sessionId: 'sess-replay-1', count: 3 })
        const events = await outboxService.replayPublishable({
            sessionId: 'sess-replay-1',
            afterSequence: '0',
            limit: 100,
        })
        expect(events).toHaveLength(3)
        expect(events.map(e => e.sessionSequence).sort()).toEqual([...sequences].sort())
    })

    it('A-05.2: replay returns only events after afterSequence', async () => {
        const sequences = await seedPublishable({ sessionId: 'sess-replay-2', count: 5 })
        const cutoff = sequences[1]
        const events = await outboxService.replayPublishable({
            sessionId: 'sess-replay-2',
            afterSequence: cutoff,
            limit: 100,
        })
        expect(events.length).toBe(3)
        for (const e of events) {
            expect(BigInt(e.sessionSequence) > BigInt(cutoff)).toBe(true)
        }
    })

    it('A-05.3: replay on empty session returns empty list', async () => {
        const events = await outboxService.replayPublishable({
            sessionId: 'sess-no-such-session',
            afterSequence: '0',
            limit: 100,
        })
        expect(events).toEqual([])
    })

    it('A-05.4: replay respects limit parameter', async () => {
        await seedPublishable({ sessionId: 'sess-replay-4', count: 10 })
        const events = await outboxService.replayPublishable({
            sessionId: 'sess-replay-4',
            afterSequence: '0',
            limit: 3,
        })
        expect(events).toHaveLength(3)
    })

    it('A-05.5: replay only returns publishable status, not pending or void', async () => {
        const inserted = await outboxService.insertPending({
            turnId: 'turn-status-mix',
            sessionId: 'sess-replay-5',
            flowRunId: 'run-replay-5',
            events: [{ eventType: 'EVT_A', payload: {} }, { eventType: 'EVT_B', payload: {} }],
        })
        const ds = databaseConnection()
        await ds.query(
            'UPDATE "interactive_flow_outbox" SET "eventStatus" = \'publishable\' WHERE "outboxEventId" = $1',
            [inserted[0].outboxEventId],
        )
        const events = await outboxService.replayPublishable({
            sessionId: 'sess-replay-5',
            afterSequence: '0',
            limit: 100,
        })
        expect(events).toHaveLength(1)
        expect(events[0].eventStatus).toBe('publishable')
    })

    it('A-05.6: replay returns events in ascending sessionSequence order', async () => {
        await seedPublishable({ sessionId: 'sess-replay-6', count: 5 })
        const events = await outboxService.replayPublishable({
            sessionId: 'sess-replay-6',
            afterSequence: '0',
            limit: 100,
        })
        const seqs = events.map(e => Number(e.sessionSequence))
        expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
    })
})
