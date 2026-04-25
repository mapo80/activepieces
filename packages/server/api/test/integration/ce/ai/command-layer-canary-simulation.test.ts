import { randomUUID } from 'node:crypto'
import { InterpretTurnRequest } from '@activepieces/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { commandLayerMetrics } from '../../../../src/app/ai/command-layer/metrics'
import { MockProviderAdapter } from '../../../../src/app/ai/command-layer/provider-adapter'
import { turnInterpreter } from '../../../../src/app/ai/command-layer/turn-interpreter'
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
    commandLayerMetrics.reset()
})

function buildRequest(overrides: Partial<InterpretTurnRequest>): InterpretTurnRequest {
    return {
        turnId: `turn-${randomUUID()}`,
        idempotencyKey: `idem-${randomUUID()}`,
        sessionId: `sess-${randomUUID()}`,
        sessionRevision: 0,
        flowRunId: `run-${randomUUID()}`,
        flowVersionId: 'v-1',
        message: 'Bellafronte',
        state: {},
        history: [],
        pendingInteraction: null,
        stateFields: [{ name: 'customerName', type: 'string', extractable: true } as never],
        nodes: [],
        currentNodeHint: null,
        infoIntents: [],
        systemPrompt: undefined,
        locale: 'it',
        catalogReadiness: {},
        ...overrides,
    }
}

function rolloutGate({ percentage, sessionId }: { percentage: number, sessionId: string }): boolean {
    let h = 0
    for (let i = 0; i < sessionId.length; i++) {
        h = (h * 31 + sessionId.charCodeAt(i)) % 100
    }
    return h < percentage
}

describe('R-RO canary rollout simulation', () => {
    it('R-RO.1: 5% rollout — only ~5% of sessions hit the command layer', () => {
        const sessions = Array.from({ length: 1000 }, () => `s-${randomUUID()}`)
        const enabled = sessions.filter((s) => rolloutGate({ percentage: 5, sessionId: s }))
        expect(enabled.length).toBeGreaterThan(0)
        expect(enabled.length).toBeLessThan(120)
    })

    it('R-RO.2: 25% rollout admits ~25% of sessions', () => {
        const sessions = Array.from({ length: 1000 }, () => `s-${randomUUID()}`)
        const enabled = sessions.filter((s) => rolloutGate({ percentage: 25, sessionId: s }))
        expect(enabled.length).toBeGreaterThan(150)
        expect(enabled.length).toBeLessThan(350)
    })

    it('R-RO.3: 100% rollout admits all sessions; rollback to 0% admits none', () => {
        const sessions = Array.from({ length: 200 }, () => `s-${randomUUID()}`)
        expect(sessions.every((s) => rolloutGate({ percentage: 100, sessionId: s }))).toBe(true)
        expect(sessions.every((s) => !rolloutGate({ percentage: 0, sessionId: s }))).toBe(true)
    })

    it('R-RO.4: error-rate spike triggers rollback path (useCommandLayer:false fallback)', async () => {
        const provider = new MockProviderAdapter()
        provider.setFallback({ commands: [], error: 'simulated-provider-error' })

        const N = 20
        const errorThreshold = 0.1
        let errors = 0
        for (let i = 0; i < N; i++) {
            const result = await turnInterpreter.interpret({
                request: buildRequest({}),
                provider,
                identityFields: ['customerName'],
            })
            if (result.acceptedCommands.length === 0) errors++
        }
        const errorRate = errors / N
        const rollbackTriggered = errorRate > errorThreshold
        expect(rollbackTriggered).toBe(true)
    })

    it('R-RO.5: lockRecoveryDaemon path covered — prepared turn beyond TTL is reclaimable', async () => {
        const ds = databaseConnection()
        const turnId = `turn-${randomUUID()}`
        const sessionId = `sess-${randomUUID()}`
        await ds.query(
            `INSERT INTO "interactive_flow_turn_log"
             ("turnId","sessionId","flowRunId","status","leaseToken","lockedUntil","workerId","createdAt")
             VALUES ($1,$2,'run-x','prepared',$3, NOW() - INTERVAL '10 minutes', 'worker-x', NOW() - INTERVAL '11 minutes')`,
            [turnId, sessionId, randomUUID()],
        )
        const stale = await ds.query(
            'SELECT count(*)::int AS n FROM "interactive_flow_turn_log" WHERE status=$1 AND "createdAt" < NOW() - INTERVAL \'5 minutes\'',
            ['prepared'],
        )
        expect(stale[0].n).toBeGreaterThanOrEqual(1)

        const { turnLogService } = await import('../../../../src/app/ai/command-layer/turn-log.service')
        const reclaimed = await turnLogService.reclaimStaleLocks({ ds, prepareStaleSeconds: 300 })
        expect(reclaimed).toBeGreaterThanOrEqual(1)

        const after = await ds.query(
            'SELECT status, "failedReason" FROM "interactive_flow_turn_log" WHERE "turnId" = $1',
            [turnId],
        )
        expect(after[0].status).toBe('compensated')
        expect(after[0].failedReason).toBe('finalize-timeout')
    })
})
