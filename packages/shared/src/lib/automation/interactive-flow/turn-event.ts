import { z } from 'zod'

const BigIntStringSchema = z.string().regex(/^[1-9][0-9]*$/, 'validation.bigint.format')

const TurnEventKindSchema = z.enum([
    'FIELD_EXTRACTED',
    'FIELD_REJECTED',
    'META_ANSWERED',
    'INFO_ANSWERED',
    'TOPIC_CHANGED',
    'OVERWRITE_PENDING',
    'OVERWRITE_CONFIRMED',
    'OVERWRITE_REJECTED',
    'CANCEL_REQUESTED',
    'CANCEL_CONFIRMED',
    'CANCEL_REJECTED',
    'CANCEL_TTL_EXPIRED',
    'REPROMPT_EMITTED',
    'TURN_COMMITTED',
    'TURN_ROLLED_BACK',
    'TURN_LEASE_EXPIRED',
    'TURN_FAILED',
    'CATALOG_PREEXEC_FAILED',
])

export const InteractiveFlowTurnEventSchema = z.object({
    outboxEventId: z.string().uuid(),
    turnId: z.string().min(1),
    sessionId: z.string().min(1),
    flowRunId: z.string().min(1),
    sessionSequence: BigIntStringSchema,
    kind: TurnEventKindSchema,
    payload: z.record(z.string(), z.unknown()),
    timestamp: z.string(),
})

export type InteractiveFlowTurnEvent = z.infer<typeof InteractiveFlowTurnEventSchema>
export type TurnEventKind = z.infer<typeof TurnEventKindSchema>
