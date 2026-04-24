import { z } from 'zod'
import {
    InteractiveFlowNodeSchema,
    InteractiveFlowStateFieldSchema,
    PendingInteractionSchema,
} from '../flows/actions/interactive-flow-action'
import { ConversationCommandSchema } from './conversation-command'
import { InfoIntentSchema } from './info-intent'
import { InteractiveFlowTurnEventSchema } from './turn-event'

const BigIntStringSchema = z.string().regex(/^[1-9][0-9]*$/, 'validation.bigint.format')

const HistoryEntrySchema = z.object({
    role: z.enum(['user', 'assistant']),
    text: z.string(),
})

const CurrentNodeHintSchema = z.object({
    nodeId: z.string().min(1),
    nodeType: z.enum(['USER_INPUT', 'CONFIRM']),
    displayName: z.string().optional(),
    stateOutputs: z.array(z.string()).optional(),
    allowedExtraFields: z.array(z.string()).optional(),
}).nullable()

export const InterpretTurnRequestSchema = z.object({
    turnId: z.string().min(1),
    idempotencyKey: z.string().min(1),
    sessionId: z.string().min(1),
    sessionRevision: z.number().int().min(0),
    flowRunId: z.string().min(1),
    flowVersionId: z.string().min(1),
    message: z.string(),
    state: z.record(z.string(), z.unknown()),
    history: z.array(HistoryEntrySchema),
    pendingInteraction: PendingInteractionSchema.nullable(),
    stateFields: z.array(InteractiveFlowStateFieldSchema),
    nodes: z.array(InteractiveFlowNodeSchema),
    currentNodeHint: CurrentNodeHintSchema,
    infoIntents: z.array(InfoIntentSchema),
    systemPrompt: z.string().optional(),
    locale: z.string().optional(),
    catalogReadiness: z.record(z.string(), z.boolean()),
})

const MessageOutSchema = z.object({
    preDagAck: z.string(),
    kind: z.enum([
        'ack-only',
        'info-answer',
        'ask-field',
        'meta-answer',
        'cancel-request',
        'cancel-confirmed',
        'reprompt',
    ]),
})

const PolicyDecisionSchema = z.object({
    command: ConversationCommandSchema,
    decision: z.enum(['accepted', 'rejected']),
    reason: z.string().optional(),
})

const PendingOverwriteSignalSchema = z.object({
    type: z.string(),
    field: z.string(),
    oldValue: z.unknown(),
    newValue: z.unknown(),
    nodeId: z.string(),
})

const TopicChangeSchema = z.object({
    topicChanged: z.boolean(),
    clearedKeys: z.array(z.string()),
})

const FinalizeContractSchema = z.object({
    turnId: z.string().min(1),
    leaseToken: z.string().uuid(),
})

export const InterpretTurnResponseSchema = z.object({
    turnStatus: z.enum(['prepared', 'replayed', 'failed']),
    messageOut: MessageOutSchema,
    stateDiff: z.record(z.string(), z.unknown()),
    pendingInteractionNext: PendingInteractionSchema.nullable(),
    topicChange: TopicChangeSchema,
    pendingOverwriteSignal: PendingOverwriteSignalSchema.nullable(),
    rejectionHint: z.string().nullable(),
    lastPolicyDecisions: z.array(PolicyDecisionSchema),
    turnEvents: z.array(InteractiveFlowTurnEventSchema),
    acceptedCommands: z.array(ConversationCommandSchema),
    rejectedCommands: z.array(z.object({
        command: ConversationCommandSchema,
        reason: z.string(),
    })),
    sessionSequenceRange: z.object({
        from: BigIntStringSchema,
        to: BigIntStringSchema,
    }).optional(),
    finalizeContract: FinalizeContractSchema,
})

export const FinalizeTurnRequestSchema = z.object({
    turnId: z.string().min(1),
    leaseToken: z.string().uuid(),
})

export const RollbackTurnRequestSchema = z.object({
    turnId: z.string().min(1),
    leaseToken: z.string().uuid(),
    reason: z.string().optional(),
})

export type InterpretTurnRequest = z.infer<typeof InterpretTurnRequestSchema>
export type InterpretTurnResponse = z.infer<typeof InterpretTurnResponseSchema>
export type FinalizeTurnRequest = z.infer<typeof FinalizeTurnRequestSchema>
export type RollbackTurnRequest = z.infer<typeof RollbackTurnRequestSchema>
export type InterpretTurnMessageOut = z.infer<typeof MessageOutSchema>
export type InterpretTurnMessageKind = InterpretTurnMessageOut['kind']
export type InterpretTurnPolicyDecision = z.infer<typeof PolicyDecisionSchema>
