import { EntitySchema, EntitySchemaColumnOptions } from 'typeorm'

export const SpikeTurnLogEntity = new EntitySchema<SpikeTurnLogSchema>({
    name: 'spike_turn_log',
    columns: {
        turnId: {
            type: String,
            length: 64,
            primary: true,
        },
        sessionId: {
            type: String,
            length: 256,
            nullable: false,
        },
        flowRunId: {
            type: String,
            length: 64,
            nullable: false,
        },
        status: {
            type: String,
            length: 16,
            nullable: false,
        },
        workerId: {
            type: String,
            length: 64,
            nullable: true,
        },
        leaseToken: {
            type: 'uuid',
            nullable: true,
        },
        lockedUntil: {
            type: 'timestamp with time zone',
            nullable: true,
        },
        acceptedCommands: {
            type: 'jsonb',
            nullable: true,
        },
        rejectedCommands: {
            type: 'jsonb',
            nullable: true,
        },
        result: {
            type: 'jsonb',
            nullable: true,
        },
        createdAt: {
            type: 'timestamp with time zone',
            nullable: false,
        } as EntitySchemaColumnOptions,
        committedAt: {
            type: 'timestamp with time zone',
            nullable: true,
        } as EntitySchemaColumnOptions,
        failedReason: {
            type: 'text',
            nullable: true,
        } as EntitySchemaColumnOptions,
    },
    indices: [
        { name: 'idx_spike_turn_log_session_id', columns: ['sessionId'] },
        { name: 'idx_spike_turn_log_status', columns: ['status'] },
        { name: 'idx_spike_turn_log_lease_expiry', columns: ['lockedUntil'] },
    ],
})

export type TurnLogStatus = 'in-progress' | 'prepared' | 'finalized' | 'compensated' | 'failed'

export type SpikeTurnLogSchema = {
    turnId: string
    sessionId: string
    flowRunId: string
    status: TurnLogStatus
    workerId: string | null
    leaseToken: string | null
    lockedUntil: Date | null
    acceptedCommands: unknown
    rejectedCommands: unknown
    result: unknown
    createdAt: Date
    committedAt: Date | null
    failedReason: string | null
}
