import { randomUUID } from 'node:crypto'
import { QueryRunner } from 'typeorm'
import { databaseConnection } from '../../database/database-connection'
import { InteractiveFlowOutboxSchema, OutboxEventStatus } from './entities/outbox-entity'
import { sessionSequenceService } from './session-sequence.service'

async function insertPending({ turnId, sessionId, flowRunId, events, queryRunner }: InsertPendingInput): Promise<InteractiveFlowOutboxSchema[]> {
    if (events.length === 0) return []
    const range = await sessionSequenceService.allocate({ sessionId, count: events.length })
    const from = BigInt(range.from)
    const runner = queryRunner ?? databaseConnection().createQueryRunner()
    const created: InteractiveFlowOutboxSchema[] = []
    try {
        if (!queryRunner) await runner.connect()
        for (let i = 0; i < events.length; i++) {
            const event = events[i]
            const sequence = (from + BigInt(i)).toString()
            const id = randomUUID()
            await runner.query(
                `
                INSERT INTO "interactive_flow_outbox" (
                    "outboxEventId","turnId","sessionId","flowRunId",
                    "sessionSequence","eventType","eventStatus","payload","createdAt"
                )
                VALUES ($1,$2,$3,$4,$5,$6,'pending',$7::jsonb, NOW())
                `,
                [id, turnId, sessionId, flowRunId, sequence, event.eventType, JSON.stringify(event.payload)],
            )
            created.push({
                outboxEventId: id,
                turnId,
                sessionId,
                flowRunId,
                sessionSequence: sequence,
                eventType: event.eventType,
                eventStatus: 'pending',
                payload: event.payload,
                createdAt: new Date(),
                publishedAt: null,
                attempts: 0,
                nextRetryAt: null,
                failedAt: null,
                claimedBy: null,
                claimedUntil: null,
            })
        }
    }
    finally {
        if (!queryRunner) await runner.release()
    }
    return created
}

async function markPublishable({ turnId }: { turnId: string }): Promise<number> {
    const ds = databaseConnection()
    const res = await ds.query(
        'UPDATE "interactive_flow_outbox" SET "eventStatus" = \'publishable\' WHERE "turnId" = $1 AND "eventStatus" = \'pending\'',
        [turnId],
    )
    return res.affectedRows ?? res.rowCount ?? 0
}

async function markVoid({ turnId }: { turnId: string }): Promise<number> {
    const ds = databaseConnection()
    const res = await ds.query(
        'UPDATE "interactive_flow_outbox" SET "eventStatus" = \'void\' WHERE "turnId" = $1 AND "eventStatus" IN (\'pending\',\'publishable\') AND "publishedAt" IS NULL',
        [turnId],
    )
    return res.affectedRows ?? res.rowCount ?? 0
}

async function claimNextSessionBatch({ publisherId, claimTtlSeconds }: { publisherId: string, claimTtlSeconds: number }): Promise<Array<Pick<InteractiveFlowOutboxSchema, 'outboxEventId' | 'sessionId' | 'sessionSequence' | 'eventType' | 'payload' | 'turnId' | 'flowRunId'>>> {
    const ds = databaseConnection()
    const runner = ds.createQueryRunner()
    try {
        await runner.connect()
        await runner.startTransaction()
        const locked = await runner.query(
            `SELECT s."sessionId"
             FROM "interactive_flow_session_sequence" s
             WHERE EXISTS (
                SELECT 1 FROM "interactive_flow_outbox" o
                WHERE o."sessionId" = s."sessionId"
                  AND o."eventStatus" = 'publishable'
                  AND o."publishedAt" IS NULL
                  AND (o."claimedUntil" IS NULL OR o."claimedUntil" < NOW())
                  AND (o."nextRetryAt" IS NULL OR o."nextRetryAt" < NOW())
             )
             ORDER BY s."sessionId"
             LIMIT 1
             FOR UPDATE OF s SKIP LOCKED`,
        )
        if (locked.length === 0) {
            await runner.commitTransaction()
            return []
        }
        const sessionId = locked[0].sessionId as string
        const result = await runner.query(
            `UPDATE "interactive_flow_outbox"
             SET "claimedBy" = $1, "claimedUntil" = NOW() + ($3 || ' seconds')::INTERVAL
             WHERE "sessionId" = $2
               AND "eventStatus" = 'publishable'
               AND "publishedAt" IS NULL
               AND ("claimedUntil" IS NULL OR "claimedUntil" < NOW())
               AND ("nextRetryAt" IS NULL OR "nextRetryAt" < NOW())
             RETURNING "outboxEventId","sessionId","sessionSequence","eventType","payload","turnId","flowRunId"`,
            [publisherId, sessionId, String(claimTtlSeconds)],
        )
        await runner.commitTransaction()
        return result.map((r: { outboxEventId: string, sessionId: string, sessionSequence: string, eventType: string, payload: unknown, turnId: string, flowRunId: string }) => ({
            outboxEventId: r.outboxEventId,
            sessionId: r.sessionId,
            sessionSequence: String(r.sessionSequence),
            eventType: r.eventType,
            payload: r.payload,
            turnId: r.turnId,
            flowRunId: r.flowRunId,
        }))
    }
    catch (err) {
        await runner.rollbackTransaction().catch(() => { /* noop */ })
        throw err
    }
    finally {
        await runner.release()
    }
}

async function markPublished({ outboxEventId }: { outboxEventId: string }): Promise<void> {
    const ds = databaseConnection()
    await ds.query(
        `UPDATE "interactive_flow_outbox"
         SET "publishedAt" = NOW(), "claimedBy" = NULL, "claimedUntil" = NULL
         WHERE "outboxEventId" = $1`,
        [outboxEventId],
    )
}

async function markRetry({ outboxEventId, backoffSeconds, maxAttempts }: { outboxEventId: string, backoffSeconds: number, maxAttempts: number }): Promise<{ dead: boolean }> {
    const ds = databaseConnection()
    const res = await ds.query(
        `UPDATE "interactive_flow_outbox"
         SET "attempts" = "attempts" + 1,
             "nextRetryAt" = NOW() + ($2 || ' seconds')::INTERVAL,
             "claimedBy" = NULL,
             "claimedUntil" = NULL,
             "failedAt" = CASE WHEN "attempts" + 1 >= $3 THEN NOW() ELSE NULL END
         WHERE "outboxEventId" = $1
         RETURNING "attempts","failedAt"`,
        [outboxEventId, String(backoffSeconds), maxAttempts],
    )
    const dead = res.length > 0 && res[0].failedAt !== null
    return { dead }
}

async function replayPublishable({ sessionId, afterSequence, limit }: { sessionId: string, afterSequence: string, limit: number }): Promise<InteractiveFlowOutboxSchema[]> {
    const ds = databaseConnection()
    const rows = await ds.query(
        `SELECT "outboxEventId","turnId","sessionId","flowRunId","sessionSequence","eventType","eventStatus","payload","createdAt","publishedAt"
         FROM "interactive_flow_outbox"
         WHERE "sessionId" = $1
           AND "eventStatus" = 'publishable'
           AND CAST("sessionSequence" AS BIGINT) > CAST($2 AS BIGINT)
         ORDER BY "sessionSequence" ASC
         LIMIT $3`,
        [sessionId, afterSequence, limit],
    )
    return rows.map((r: { outboxEventId: string, turnId: string, sessionId: string, flowRunId: string, sessionSequence: string, eventType: string, eventStatus: OutboxEventStatus, payload: unknown, createdAt: Date, publishedAt: Date | null }) => ({
        outboxEventId: r.outboxEventId,
        turnId: r.turnId,
        sessionId: r.sessionId,
        flowRunId: r.flowRunId,
        sessionSequence: String(r.sessionSequence),
        eventType: r.eventType,
        eventStatus: r.eventStatus,
        payload: r.payload,
        createdAt: r.createdAt,
        publishedAt: r.publishedAt,
        attempts: 0,
        nextRetryAt: null,
        failedAt: null,
        claimedBy: null,
        claimedUntil: null,
    }))
}

export const outboxService = {
    insertPending,
    markPublishable,
    markVoid,
    claimNextSessionBatch,
    markPublished,
    markRetry,
    replayPublishable,
}

export type InsertPendingInput = {
    turnId: string
    sessionId: string
    flowRunId: string
    events: Array<{ eventType: string, payload: unknown }>
    queryRunner?: QueryRunner
}

export { OutboxEventStatus }
