import { z } from 'zod'

const FieldUpdateSchema = z.object({
    field: z.string().min(1),
    value: z.unknown(),
    evidence: z.string().min(2),
    confidence: z.number().min(0).max(1).optional(),
})

const SetFieldsCommandSchema = z.object({
    type: z.literal('SET_FIELDS'),
    updates: z.array(FieldUpdateSchema).min(1),
})

const AskFieldCommandSchema = z.object({
    type: z.literal('ASK_FIELD'),
    field: z.string().min(1),
    reason: z.string().optional(),
})

const AnswerMetaCommandSchema = z.object({
    type: z.literal('ANSWER_META'),
    kind: z.enum(['ask-repeat', 'ask-clarify', 'ask-progress', 'ask-help']),
    message: z.string().optional(),
})

const AnswerInfoCommandSchema = z.object({
    type: z.literal('ANSWER_INFO'),
    infoIntent: z.string().min(1),
    citedFields: z.array(z.string().min(1)).min(1),
})

const RequestCancelCommandSchema = z.object({
    type: z.literal('REQUEST_CANCEL'),
    reason: z.string().optional(),
})

const ResolvePendingCommandSchema = z.object({
    type: z.literal('RESOLVE_PENDING'),
    decision: z.enum(['accept', 'reject']),
    pendingType: z.enum([
        'confirm_binary',
        'pick_from_list',
        'pending_overwrite',
        'pending_cancel',
    ]),
})

const RepromptCommandSchema = z.object({
    type: z.literal('REPROMPT'),
    reason: z.enum([
        'low-confidence',
        'policy-rejected',
        'off-topic',
        'ambiguous-input',
        'provider-error',
        'catalog-not-ready',
    ]),
})

export const ConversationCommandSchema = z.discriminatedUnion('type', [
    SetFieldsCommandSchema,
    AskFieldCommandSchema,
    AnswerMetaCommandSchema,
    AnswerInfoCommandSchema,
    RequestCancelCommandSchema,
    ResolvePendingCommandSchema,
    RepromptCommandSchema,
])

export type FieldUpdate = z.infer<typeof FieldUpdateSchema>
export type SetFieldsCommand = z.infer<typeof SetFieldsCommandSchema>
export type AskFieldCommand = z.infer<typeof AskFieldCommandSchema>
export type AnswerMetaCommand = z.infer<typeof AnswerMetaCommandSchema>
export type AnswerInfoCommand = z.infer<typeof AnswerInfoCommandSchema>
export type RequestCancelCommand = z.infer<typeof RequestCancelCommandSchema>
export type ResolvePendingCommand = z.infer<typeof ResolvePendingCommandSchema>
export type RepromptCommand = z.infer<typeof RepromptCommandSchema>
export type ConversationCommand = z.infer<typeof ConversationCommandSchema>

export type MetaKind = AnswerMetaCommand['kind']
export type RepromptReason = RepromptCommand['reason']
export type PendingKind = ResolvePendingCommand['pendingType']
