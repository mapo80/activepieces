import { randomUUID } from 'node:crypto'
import { DataSource } from 'typeorm'
import { databaseConnection } from '../../database/database-connection'
import { InteractiveFlowTurnLogEntity, InteractiveFlowTurnLogSchema, TurnLogStatus } from './entities/turn-log-entity'

async function acquireLease({ turnId, sessionId, flowRunId, workerId, ttlSeconds }: AcquireLeaseInput): Promise<AcquireLeaseResult> {
    const ds = databaseConnection()
    const leaseToken = randomUUID()
    const rows = await ds.query(
        `
        INSERT INTO "interactive_flow_turn_log" (
            "turnId", "sessionId", "flowRunId", "status",
            "workerId", "leaseToken", "lockedUntil", "createdAt"
        )
        VALUES ($1, $2, $3, 'in-progress', $4, $5, NOW() + ($6 || ' seconds')::INTERVAL, NOW())
        ON CONFLICT ("turnId") DO UPDATE SET
            "workerId"    = EXCLUDED."workerId",
            "leaseToken"  = EXCLUDED."leaseToken",
            "lockedUntil" = EXCLUDED."lockedUntil"
        WHERE "interactive_flow_turn_log"."status" = 'in-progress'
          AND "interactive_flow_turn_log"."lockedUntil" < NOW()
        RETURNING "turnId", "sessionId", "flowRunId", "status", "workerId", "leaseToken", "lockedUntil"
        `,
        [turnId, sessionId, flowRunId, workerId, leaseToken, String(ttlSeconds)],
    )

    if (rows.length > 0) {
        return { outcome: 'acquired', leaseToken, row: rows[0] as Partial<InteractiveFlowTurnLogSchema> }
    }

    const existing = await ds.getRepository<InteractiveFlowTurnLogSchema>(InteractiveFlowTurnLogEntity).findOne({ where: { turnId } })
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

async function heartbeat({ turnId, leaseToken, ttlSeconds }: HeartbeatInput): Promise<boolean> {
    const ds = databaseConnection()
    const result = await ds.query(
        `
        UPDATE "interactive_flow_turn_log"
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

async function prepare({ turnId, leaseToken, acceptedCommands, rejectedCommands, result }: PrepareInput): Promise<boolean> {
    const ds = databaseConnection()
    const rows = await ds.query(
        `
        UPDATE "interactive_flow_turn_log"
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
        [turnId, leaseToken, sanitizeJson(acceptedCommands), sanitizeJson(rejectedCommands), sanitizeJson(result)],
    )
    return rows.length > 0
}

async function finalize({ turnId, leaseToken }: FinalizeInput): Promise<boolean> {
    const ds = databaseConnection()
    const rows = await ds.query(
        `
        UPDATE "interactive_flow_turn_log"
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

async function compensate({ turnId, leaseToken, reason }: CompensateInput): Promise<boolean> {
    const ds = databaseConnection()
    const rows = await ds.query(
        `
        UPDATE "interactive_flow_turn_log"
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

async function fail({ turnId, leaseToken, reason }: FailInput): Promise<boolean> {
    const ds = databaseConnection()
    const rows = await ds.query(
        `
        UPDATE "interactive_flow_turn_log"
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

function sanitizeJson(value: unknown): string {
    return JSON.stringify(value).replace(/\\u0000/g, '').replace(/\\u200[bcdef]/g, '')
}

async function findByTurnId({ turnId }: { turnId: string }): Promise<InteractiveFlowTurnLogSchema | null> {
    const ds = databaseConnection()
    const repo = ds.getRepository<InteractiveFlowTurnLogSchema>(InteractiveFlowTurnLogEntity)
    const row = await repo.findOne({ where: { turnId } })
    return row ?? null
}

async function reclaimStaleLocks({ ds, prepareStaleSeconds }: ReclaimInput): Promise<number> {
    const expired = await ds.query(
        `
        UPDATE "interactive_flow_turn_log"
        SET "status" = 'failed', "failedReason" = 'lease-expired'
        WHERE "status" = 'in-progress' AND "lockedUntil" < NOW()
        RETURNING "turnId"
        `,
    )
    const staleSagas = await ds.query(
        `
        UPDATE "interactive_flow_turn_log"
        SET "status" = 'compensated', "failedReason" = 'finalize-timeout'
        WHERE "status" = 'prepared'
          AND "createdAt" < NOW() - ($1 || ' seconds')::INTERVAL
        RETURNING "turnId"
        `,
        [String(prepareStaleSeconds)],
    )
    return expired.length + staleSagas.length
}

export const turnLogService = {
    acquireLease,
    heartbeat,
    prepare,
    finalize,
    compensate,
    fail,
    findByTurnId,
    reclaimStaleLocks,
}

export type AcquireLeaseInput = {
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
    row?: Partial<InteractiveFlowTurnLogSchema>
}

export type HeartbeatInput = {
    turnId: string
    leaseToken: string
    ttlSeconds: number
}

export type PrepareInput = {
    turnId: string
    leaseToken: string
    acceptedCommands: unknown
    rejectedCommands: unknown
    result: unknown
}

export type FinalizeInput = {
    turnId: string
    leaseToken: string
}

export type CompensateInput = {
    turnId: string
    leaseToken: string
    reason?: string
}

export type FailInput = {
    turnId: string
    leaseToken: string
    reason?: string
}

export type ReclaimInput = {
    ds: DataSource
    prepareStaleSeconds: number
}

export { TurnLogStatus }
