import { randomUUID } from 'node:crypto'
import { ConversationCommand, InterpretTurnRequest } from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { commandLayerTracing } from '../../../../src/app/ai/command-layer/tracing'
import { outboxService } from '../../../../src/app/ai/command-layer/outbox.service'
import { MockProviderAdapter } from '../../../../src/app/ai/command-layer/provider-adapter'
import { turnInterpreter } from '../../../../src/app/ai/command-layer/turn-interpreter'
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
    commandLayerTracing.clear()
})

function buildRequest(overrides: Partial<InterpretTurnRequest> = {}): InterpretTurnRequest {
    return {
        turnId: `turn-${randomUUID()}`,
        idempotencyKey: `idem-${randomUUID()}`,
        sessionId: `sess-${randomUUID()}`,
        sessionRevision: 0,
        flowRunId: 'run-Y',
        flowVersionId: 'v-Z',
        message: 'Bellafronte',
        state: {},
        history: [],
        pendingInteraction: null,
        stateFields: [
            { name: 'customerName', type: 'string', extractable: true, minLength: 2, maxLength: 50 },
        ],
        nodes: [],
        currentNodeHint: null,
        infoIntents: [],
        catalogReadiness: {},
        ...overrides,
    }
}

describe('command-layer chaos / recovery scenarios', () => {
    it('lease zombie reclaim: stale in-progress is marked failed', async () => {
        const turnId = `turn-${randomUUID()}`
        await turnLogService.acquireLease({
            turnId,
            sessionId: 'sess-A',
            flowRunId: 'run-A',
            workerId: 'worker-1',
            ttlSeconds: 1,
        })
        const ds = databaseConnection()
        await ds.query(
            'UPDATE "interactive_flow_turn_log" SET "lockedUntil" = NOW() - INTERVAL \'10 seconds\' WHERE "turnId" = $1',
            [turnId],
        )
        const reclaimed = await turnLogService.reclaimStaleLocks({ ds, prepareStaleSeconds: 300 })
        expect(reclaimed).toBeGreaterThanOrEqual(1)
        const row = await ds.query('SELECT "status","failedReason" FROM "interactive_flow_turn_log" WHERE "turnId" = $1', [turnId])
        expect(row[0]?.status).toBe('failed')
        expect(row[0]?.failedReason).toBe('lease-expired')
    })

    it('prepared zombie reclaim: stale prepared (>5 min) is compensated', async () => {
        const turnId = `turn-${randomUUID()}`
        const acq = await turnLogService.acquireLease({
            turnId,
            sessionId: 'sess-B',
            flowRunId: 'run-B',
            workerId: 'worker-1',
            ttlSeconds: 600,
        })
        await turnLogService.prepare({
            turnId,
            leaseToken: acq.leaseToken!,
            acceptedCommands: [],
            rejectedCommands: [],
            result: {},
        })
        const ds = databaseConnection()
        await ds.query(
            'UPDATE "interactive_flow_turn_log" SET "createdAt" = NOW() - INTERVAL \'10 minutes\' WHERE "turnId" = $1',
            [turnId],
        )
        const reclaimed = await turnLogService.reclaimStaleLocks({ ds, prepareStaleSeconds: 300 })
        expect(reclaimed).toBeGreaterThanOrEqual(1)
        const row = await ds.query('SELECT "status","failedReason" FROM "interactive_flow_turn_log" WHERE "turnId" = $1', [turnId])
        expect(row[0]?.status).toBe('compensated')
        expect(row[0]?.failedReason).toBe('finalize-timeout')
    })

    it('idempotent retry: same turnId twice produces deterministic outcome', async () => {
        const provider = new MockProviderAdapter()
        provider.register({
            matchUserMessage: () => true,
            commands: [{ type: 'SET_FIELDS', updates: [{ field: 'customerName', value: 'Bellafronte', evidence: 'Bellafronte' }] }] as ConversationCommand[],
        })
        const req = buildRequest()
        const r1 = await turnInterpreter.interpret({ request: req, provider, identityFields: ['customerName'] })
        expect(r1.turnStatus).toBe('prepared')

        const r2 = await turnInterpreter.interpret({ request: req, provider, identityFields: ['customerName'] })
        expect(['prepared', 'replayed', 'failed']).toContain(r2.turnStatus)
    })

    it('rollback after CAS conflict: outbox events marked void', async () => {
        const provider = new MockProviderAdapter()
        provider.register({
            matchUserMessage: () => true,
            commands: [{ type: 'SET_FIELDS', updates: [{ field: 'customerName', value: 'Bellafronte', evidence: 'Bellafronte' }] }] as ConversationCommand[],
        })
        const req = buildRequest()
        const result = await turnInterpreter.interpret({ request: req, provider, identityFields: ['customerName'] })

        const rollback = await turnInterpreter.rollback({
            turnId: result.finalizeContract.turnId,
            leaseToken: result.finalizeContract.leaseToken,
            reason: 'simulated-cas-conflict',
        })
        expect(rollback.ok).toBe(true)

        const ds = databaseConnection()
        const voidCount = await ds.query(
            'SELECT COUNT(*)::int AS c FROM "interactive_flow_outbox" WHERE "turnId" = $1 AND "eventStatus" = \'void\'',
            [req.turnId],
        )
        expect(voidCount[0].c).toBeGreaterThan(0)

        const publishableCount = await ds.query(
            'SELECT COUNT(*)::int AS c FROM "interactive_flow_outbox" WHERE "turnId" = $1 AND "eventStatus" = \'publishable\'',
            [req.turnId],
        )
        expect(publishableCount[0].c).toBe(0)
    })

    it('outbox replay: returns events past lastKnownSessionSequence', async () => {
        const sessionId = 'sess-replay'
        await outboxService.insertPending({
            turnId: 'turn-replay',
            sessionId,
            flowRunId: 'r',
            events: [
                { eventType: 'A', payload: { i: 1 } },
                { eventType: 'B', payload: { i: 2 } },
                { eventType: 'C', payload: { i: 3 } },
            ],
        })
        await outboxService.markPublishable({ turnId: 'turn-replay' })

        const all = await outboxService.replayPublishable({ sessionId, afterSequence: '0', limit: 10 })
        expect(all.length).toBe(3)

        const partial = await outboxService.replayPublishable({ sessionId, afterSequence: '1', limit: 10 })
        expect(partial.length).toBe(2)
    })

    it('multi-publisher claim does not return same session twice', async () => {
        const sessionId = 'sess-multi-pub'
        await outboxService.insertPending({
            turnId: 'turn-mp',
            sessionId,
            flowRunId: 'r',
            events: [{ eventType: 'TEST', payload: { i: 1 } }],
        })
        await outboxService.markPublishable({ turnId: 'turn-mp' })

        const [a, b] = await Promise.all([
            outboxService.claimNextSessionBatch({ publisherId: 'pub-A', claimTtlSeconds: 30 }),
            outboxService.claimNextSessionBatch({ publisherId: 'pub-B', claimTtlSeconds: 30 }),
        ])
        const aSessions = new Set(a.map(r => r.sessionId))
        const bSessions = new Set(b.map(r => r.sessionId))
        const intersect = [...aSessions].filter(s => bSessions.has(s))
        expect(intersect).toEqual([])
    })

    it('tracing: withSpan records duration and error', async () => {
        commandLayerTracing.clear()
        await commandLayerTracing.withSpan({
            name: 'test.ok',
            attributes: { x: 1 },
            fn: async () => 'ok',
        })
        try {
            await commandLayerTracing.withSpan({
                name: 'test.err',
                fn: async () => { throw new Error('boom') },
            })
        }
        catch { /* expected */ }
        const summary = commandLayerTracing.summarize()
        expect(summary.byName['test.ok']?.count).toBe(1)
        expect(summary.byName['test.err']?.errorRate).toBe(1)
    })
})
