import { randomUUID } from 'node:crypto'
import { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { outboxService } from '../../../../src/app/ai/command-layer/outbox.service'
import { sessionSequenceService } from '../../../../src/app/ai/command-layer/session-sequence.service'
import { turnLogService } from '../../../../src/app/ai/command-layer/turn-log.service'
import { databaseConnection } from '../../../../src/app/database/database-connection'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance

beforeAll(async () => {
    app = await setupTestEnvironment()
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

function newTurnId(): string {
    return `turn-${randomUUID()}`
}

describe('command-layer turnLogService', () => {
    it('acquires lease exactly once when 4 workers compete on same turnId', async () => {
        const turnId = newTurnId()
        const sessionId = 'sess-A'
        const results = await Promise.all(
            [0, 1, 2, 3].map(i => turnLogService.acquireLease({
                turnId,
                sessionId,
                flowRunId: 'run-1',
                workerId: `w-${i}`,
                ttlSeconds: 30,
            })),
        )
        const acquired = results.filter(r => r.outcome === 'acquired').length
        expect(acquired).toBe(1)
    })

    it('rejects stale worker commit after recovery', async () => {
        const turnId = newTurnId()
        const acq = await turnLogService.acquireLease({
            turnId, sessionId: 's', flowRunId: 'r', workerId: 'w1', ttlSeconds: 30,
        })
        expect(acq.outcome).toBe('acquired')
        const ds = databaseConnection()
        await ds.query(
            'UPDATE "interactive_flow_turn_log" SET "lockedUntil" = NOW() - INTERVAL \'5 seconds\' WHERE "turnId" = $1',
            [turnId],
        )
        await turnLogService.reclaimStaleLocks({ ds, prepareStaleSeconds: 300 })
        const prepared = await turnLogService.prepare({
            turnId,
            leaseToken: acq.leaseToken!,
            acceptedCommands: [],
            rejectedCommands: [],
            result: {},
        })
        expect(prepared).toBe(false)
    })

    it('finalize and compensate are disjoint; double-finalize rejected', async () => {
        const turnIdA = newTurnId()
        const turnIdB = newTurnId()
        const acqA = await turnLogService.acquireLease({ turnId: turnIdA, sessionId: 'sA', flowRunId: 'rA', workerId: 'w1', ttlSeconds: 30 })
        const acqB = await turnLogService.acquireLease({ turnId: turnIdB, sessionId: 'sB', flowRunId: 'rB', workerId: 'w1', ttlSeconds: 30 })

        await turnLogService.prepare({ turnId: turnIdA, leaseToken: acqA.leaseToken!, acceptedCommands: [], rejectedCommands: [], result: {} })
        await turnLogService.prepare({ turnId: turnIdB, leaseToken: acqB.leaseToken!, acceptedCommands: [], rejectedCommands: [], result: {} })

        const fA = await turnLogService.finalize({ turnId: turnIdA, leaseToken: acqA.leaseToken! })
        const cB = await turnLogService.compensate({ turnId: turnIdB, leaseToken: acqB.leaseToken!, reason: 'test' })
        const dupe = await turnLogService.finalize({ turnId: turnIdB, leaseToken: acqB.leaseToken! })

        expect(fA).toBe(true)
        expect(cB).toBe(true)
        expect(dupe).toBe(false)
    })
})

describe('command-layer sessionSequenceService', () => {
    it('allocates monotonically for 100 concurrent single allocations', async () => {
        const sessionId = 'sess-seq'
        const ranges = await Promise.all(
            Array.from({ length: 100 }, () => sessionSequenceService.allocate({ sessionId, count: 1 })),
        )
        const froms = new Set(ranges.map(r => r.from))
        expect(froms.size).toBe(100)
        const max = ranges.reduce((m, r) => BigInt(r.to) > BigInt(m) ? r.to : m, '0')
        expect(max).toBe('100')
    })
})

describe('command-layer outboxService', () => {
    it('claims only one session per publisher, preserves per-session sequence', async () => {
        const ds = databaseConnection()
        for (const sid of ['X', 'Y', 'Z']) {
            await outboxService.insertPending({
                turnId: `turn-${sid}-t`,
                sessionId: sid,
                flowRunId: 'r',
                events: Array.from({ length: 5 }, (_, i) => ({ eventType: 'TEST', payload: { i } })),
            })
            await ds.query(`UPDATE "interactive_flow_outbox" SET "eventStatus" = 'publishable' WHERE "sessionId" = $1`, [sid])
        }

        const [a, b] = await Promise.all([
            outboxService.claimNextSessionBatch({ publisherId: 'pub-A', claimTtlSeconds: 30 }),
            outboxService.claimNextSessionBatch({ publisherId: 'pub-B', claimTtlSeconds: 30 }),
        ])

        const aSessions = new Set(a.map(r => r.sessionId))
        const bSessions = new Set(b.map(r => r.sessionId))
        const intersect = [...aSessions].filter(s => bSessions.has(s))
        expect(intersect).toEqual([])

        for (const rows of [a, b]) {
            const bySession: Record<string, string[]> = {}
            for (const r of rows) {
                bySession[r.sessionId] = bySession[r.sessionId] ?? []
                bySession[r.sessionId].push(r.sessionSequence)
            }
            for (const seqs of Object.values(bySession)) {
                for (let i = 1; i < seqs.length; i++) {
                    expect(BigInt(seqs[i]) >= BigInt(seqs[i - 1])).toBe(true)
                }
            }
        }
    })

    it('insertPending + markPublishable + markVoid lifecycle works', async () => {
        const created = await outboxService.insertPending({
            turnId: 't-lifecycle', sessionId: 's-lifecycle', flowRunId: 'r',
            events: [{ eventType: 'A', payload: { v: 1 } }, { eventType: 'B', payload: { v: 2 } }],
        })
        expect(created.length).toBe(2)
        expect(BigInt(created[0].sessionSequence)).toBe(1n)
        expect(BigInt(created[1].sessionSequence)).toBe(2n)

        await outboxService.markPublishable({ turnId: 't-lifecycle' })

        const ds = databaseConnection()
        const publishable = await ds.query(
            `SELECT COUNT(*)::int AS c FROM "interactive_flow_outbox" WHERE "turnId" = $1 AND "eventStatus" = 'publishable'`,
            ['t-lifecycle'],
        )
        expect(publishable[0].c).toBe(2)

        await outboxService.markVoid({ turnId: 't-lifecycle' })
        const voided = await ds.query(
            `SELECT COUNT(*)::int AS c FROM "interactive_flow_outbox" WHERE "turnId" = $1 AND "eventStatus" = 'void'`,
            ['t-lifecycle'],
        )
        expect(voided[0].c).toBe(2)
    })
})
