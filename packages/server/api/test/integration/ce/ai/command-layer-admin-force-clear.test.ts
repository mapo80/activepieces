import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { turnLogService } from '../../../../src/app/ai/command-layer/turn-log.service'
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

async function seedInProgressLocked({ secondsAgo }: { secondsAgo: number }): Promise<string> {
    const ds = databaseConnection()
    const turnId = `turn-${randomUUID()}`
    await ds.query(
        `INSERT INTO "interactive_flow_turn_log"
         ("turnId","sessionId","flowRunId","workerId","leaseToken","status","lockedUntil","createdAt")
         VALUES ($1, $2, $3, $4, $5, 'in-progress', NOW() - INTERVAL '${secondsAgo} seconds', NOW())`,
        [turnId, 'sess-stale', 'run-stale', 'worker-A', randomUUID()],
    )
    return turnId
}

async function seedPrepared({ secondsAgo }: { secondsAgo: number }): Promise<string> {
    const ds = databaseConnection()
    const turnId = `turn-${randomUUID()}`
    await ds.query(
        `INSERT INTO "interactive_flow_turn_log"
         ("turnId","sessionId","flowRunId","workerId","leaseToken","status","lockedUntil","createdAt")
         VALUES ($1, $2, $3, $4, $5, 'prepared', NULL, NOW() - INTERVAL '${secondsAgo} seconds')`,
        [turnId, 'sess-prep', 'run-prep', 'worker-B', randomUUID()],
    )
    return turnId
}

describe('command-layer admin force-clear-stale', () => {
    it('A-08.1: reclaims expired in-progress locks (lease-expired)', async () => {
        const stale = await seedInProgressLocked({ secondsAgo: 60 })
        const ds = databaseConnection()
        const reclaimed = await turnLogService.reclaimStaleLocks({ ds, prepareStaleSeconds: 300 })
        expect(reclaimed).toBeGreaterThanOrEqual(1)
        const row = await turnLogService.findByTurnId({ turnId: stale })
        expect(row?.status).toBe('failed')
        expect(row?.failedReason).toBe('lease-expired')
    })

    it('A-08.2: reclaims stale prepared sagas as compensated (finalize-timeout)', async () => {
        const turn = await seedPrepared({ secondsAgo: 600 })
        const ds = databaseConnection()
        const reclaimed = await turnLogService.reclaimStaleLocks({ ds, prepareStaleSeconds: 300 })
        expect(reclaimed).toBeGreaterThanOrEqual(1)
        const row = await turnLogService.findByTurnId({ turnId: turn })
        expect(row?.status).toBe('compensated')
        expect(row?.failedReason).toBe('finalize-timeout')
    })

    it('A-08.3: returns 0 when nothing is stale', async () => {
        const ds = databaseConnection()
        const reclaimed = await turnLogService.reclaimStaleLocks({ ds, prepareStaleSeconds: 300 })
        expect(reclaimed).toBe(0)
    })

    it('A-08.4: prepareStaleSeconds threshold respected (recent prepared not reclaimed)', async () => {
        const turn = await seedPrepared({ secondsAgo: 30 })
        const ds = databaseConnection()
        const reclaimed = await turnLogService.reclaimStaleLocks({ ds, prepareStaleSeconds: 300 })
        const row = await turnLogService.findByTurnId({ turnId: turn })
        expect(row?.status).toBe('prepared')
        expect(reclaimed).toBe(0)
    })

    it('A-08.5: combined in-progress + prepared scenarios both reclaimed', async () => {
        const inFlight = await seedInProgressLocked({ secondsAgo: 60 })
        const prepared = await seedPrepared({ secondsAgo: 600 })
        const ds = databaseConnection()
        const reclaimed = await turnLogService.reclaimStaleLocks({ ds, prepareStaleSeconds: 300 })
        expect(reclaimed).toBeGreaterThanOrEqual(2)
        const r1 = await turnLogService.findByTurnId({ turnId: inFlight })
        const r2 = await turnLogService.findByTurnId({ turnId: prepared })
        expect(r1?.status).toBe('failed')
        expect(r2?.status).toBe('compensated')
    })
})
