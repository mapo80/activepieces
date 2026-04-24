import { EntitySchema } from 'typeorm'

export const SpikeOutboxEntity = new EntitySchema<SpikeOutboxSchema>({
    name: 'spike_outbox',
    columns: {
        outboxEventId: {
            type: 'uuid',
            primary: true,
        },
        turnId: {
            type: String,
            length: 64,
            nullable: false,
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
        sessionSequence: {
            type: 'bigint',
            nullable: false,
        },
        eventType: {
            type: String,
            length: 64,
            nullable: false,
        },
        eventStatus: {
            type: String,
            length: 16,
            nullable: false,
        },
        payload: {
            type: 'jsonb',
            nullable: false,
        },
        createdAt: {
            type: 'timestamp with time zone',
            nullable: false,
        },
        publishedAt: {
            type: 'timestamp with time zone',
            nullable: true,
        },
        attempts: {
            type: 'integer',
            default: 0,
            nullable: false,
        },
        nextRetryAt: {
            type: 'timestamp with time zone',
            nullable: true,
        },
        failedAt: {
            type: 'timestamp with time zone',
            nullable: true,
        },
        claimedBy: {
            type: String,
            length: 64,
            nullable: true,
        },
        claimedUntil: {
            type: 'timestamp with time zone',
            nullable: true,
        },
    },
    uniques: [
        { name: 'uq_spike_outbox_session_sequence', columns: ['sessionId', 'sessionSequence'] },
    ],
    indices: [
        { name: 'idx_spike_outbox_session_sequence', columns: ['sessionId', 'sessionSequence'] },
        { name: 'idx_spike_outbox_turn_id', columns: ['turnId'] },
        { name: 'idx_spike_outbox_claim', columns: ['claimedUntil'] },
    ],
})

export type OutboxEventStatus = 'pending' | 'publishable' | 'void'

export type SpikeOutboxSchema = {
    outboxEventId: string
    turnId: string
    sessionId: string
    flowRunId: string
    sessionSequence: string
    eventType: string
    eventStatus: OutboxEventStatus
    payload: unknown
    createdAt: Date
    publishedAt: Date | null
    attempts: number
    nextRetryAt: Date | null
    failedAt: Date | null
    claimedBy: string | null
    claimedUntil: Date | null
}
