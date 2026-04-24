import { randomUUID } from 'node:crypto'
import { DataSource } from 'typeorm'
import { SpikeTurnLogEntity, SpikeTurnLogSchema } from './entities/spike-turn-log-entity'

async function acquireLease({ ds, turnId, sessionId, flowRunId, workerId, ttlSeconds }: AcquireLeaseInput): Promise<AcquireLeaseResult> {
    const leaseToken = randomUUID()
    const rows = await ds.query(
        `
        INSERT INTO "spike_turn_log" (
            "turnId", "sessionId", "flowRunId", "status",
            "workerId", "leaseToken", "lockedUntil", "createdAt"
        )
        VALUES ($1, $2, $3, 'in-progress', $4, $5, NOW() + ($6 || ' seconds')::INTERVAL, NOW())
        ON CONFLICT ("turnId") DO UPDATE SET
            "workerId"     = EXCLUDED."workerId",
            "leaseToken"   = EXCLUDED."leaseToken",
            "lockedUntil"  = EXCLUDED."lockedUntil"
        WHERE "spike_turn_log"."status" = 'in-progress'
          AND "spike_turn_log"."lockedUntil" < NOW()
        RETURNING "turnId", "sessionId", "flowRunId", "status", "workerId", "leaseToken", "lockedUntil"
        `,
        [turnId, sessionId, flowRunId, workerId, leaseToken, String(ttlSeconds)],
    )

    if (rows.length > 0) {
        return { outcome: 'acquired', leaseToken, row: rows[0] }
    }

    const existing = await ds.getRepository<SpikeTurnLogSchema>(SpikeTurnLogEntity).findOne({ where: { turnId } })
    if (!existing) {
        return { outcome: 'unknown-error' }
    }
    switch (existing.status) {
        case 'finalized':
        case 'compensated':
            return { outcome: 'replay', row: existing }
        case 'failed':
            return { outcome: 'failed-previous', row: existing }
        case 'in-progress':
        case 'prepared':
        default:
            return { outcome: 'locked-by-other', row: existing }
    }
}

async function heartbeat({ ds, turnId, leaseToken, ttlSeconds }: HeartbeatInput): Promise<boolean> {
    const result = await ds.query(
        `
        UPDATE "spike_turn_log"
        SET "lockedUntil" = NOW() + ($3 || ' seconds')::INTERVAL
        WHERE "turnId"       = $1
          AND "leaseToken"   = $2
          AND "status"       = 'in-progress'
          AND "lockedUntil" >= NOW()
        RETURNING "turnId"
        `,
        [turnId, leaseToken, String(ttlSeconds)],
    )
    return result.length > 0
}

async function prepare({ ds, turnId, leaseToken, acceptedCommands, rejectedCommands, result }: PrepareInput): Promise<boolean> {
    const rows = await ds.query(
        `
        UPDATE "spike_turn_log"
        SET "status"            = 'prepared',
            "acceptedCommands"  = $3::jsonb,
            "rejectedCommands"  = $4::jsonb,
            "result"            = $5::jsonb,
            "committedAt"       = NOW()
        WHERE "turnId"       = $1
          AND "leaseToken"   = $2
          AND "status"       = 'in-progress'
          AND "lockedUntil" >= NOW()
        RETURNING "turnId"
        `,
        [turnId, leaseToken, JSON.stringify(acceptedCommands), JSON.stringify(rejectedCommands), JSON.stringify(result)],
    )
    return rows.length > 0
}

async function finalize({ ds, turnId, leaseToken }: FinalizeInput): Promise<boolean> {
    const rows = await ds.query(
        `
        UPDATE "spike_turn_log"
        SET "status" = 'finalized'
        WHERE "turnId"     = $1
          AND "leaseToken" = $2
          AND "status"     = 'prepared'
        RETURNING "turnId"
        `,
        [turnId, leaseToken],
    )
    return rows.length > 0
}

async function compensate({ ds, turnId, leaseToken, reason }: CompensateInput): Promise<boolean> {
    const rows = await ds.query(
        `
        UPDATE "spike_turn_log"
        SET "status"       = 'compensated',
            "failedReason" = $3
        WHERE "turnId"     = $1
          AND "leaseToken" = $2
          AND "status"     = 'prepared'
        RETURNING "turnId"
        `,
        [turnId, leaseToken, reason ?? null],
    )
    return rows.length > 0
}

async function fail({ ds, turnId, leaseToken, reason }: FailInput): Promise<boolean> {
    const rows = await ds.query(
        `
        UPDATE "spike_turn_log"
        SET "status"       = 'failed',
            "failedReason" = $3
        WHERE "turnId"     = $1
          AND "leaseToken" = $2
          AND "status"     = 'in-progress'
        RETURNING "turnId"
        `,
        [turnId, leaseToken, reason ?? null],
    )
    return rows.length > 0
}

async function reclaimStaleLocks({ ds, prepareStaleSeconds }: { ds: DataSource, prepareStaleSeconds: number }): Promise<number> {
    const staleInProgress = await ds.query(
        `
        UPDATE "spike_turn_log"
        SET "status" = 'failed', "failedReason" = 'lease-expired'
        WHERE "status" = 'in-progress' AND "lockedUntil" < NOW()
        RETURNING "turnId"
        `,
    )
    const staleSagas = await ds.query(
        `
        UPDATE "spike_turn_log"
        SET "status" = 'compensated', "failedReason" = 'finalize-timeout'
        WHERE "status" = 'prepared'
          AND "createdAt" < NOW() - ($1 || ' seconds')::INTERVAL
        RETURNING "turnId"
        `,
        [String(prepareStaleSeconds)],
    )
    return staleInProgress.length + staleSagas.length
}

export const spikeLeaseService = {
    acquireLease,
    heartbeat,
    prepare,
    finalize,
    compensate,
    fail,
    reclaimStaleLocks,
}

export type AcquireLeaseInput = {
    ds: DataSource
    turnId: string
    sessionId: string
    flowRunId: string
    workerId: string
    ttlSeconds: number
}

export type AcquireLeaseOutcome =
    | 'acquired'
    | 'locked-by-other'
    | 'replay'
    | 'failed-previous'
    | 'unknown-error'

export type AcquireLeaseResult = {
    outcome: AcquireLeaseOutcome
    leaseToken?: string
    row?: Partial<SpikeTurnLogSchema>
}

export type HeartbeatInput = {
    ds: DataSource
    turnId: string
    leaseToken: string
    ttlSeconds: number
}

export type PrepareInput = {
    ds: DataSource
    turnId: string
    leaseToken: string
    acceptedCommands: unknown
    rejectedCommands: unknown
    result: unknown
}

export type FinalizeInput = {
    ds: DataSource
    turnId: string
    leaseToken: string
}

export type CompensateInput = {
    ds: DataSource
    turnId: string
    leaseToken: string
    reason?: string
}

export type FailInput = {
    ds: DataSource
    turnId: string
    leaseToken: string
    reason?: string
}
