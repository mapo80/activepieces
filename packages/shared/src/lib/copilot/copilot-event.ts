import { z } from 'zod'
import { FlowVersion } from '../automation/flows/flow-version'
import { FlowOperationRequest } from '../automation/flows/operations'

export const CopilotScopeSchema = z.enum([
    'INTERACTIVE_FLOW',
    'EMPTY_OR_NEW',
])

export const AppliedInverseSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('flow-operation'),
        op: z.unknown(),
    }),
    z.object({
        kind: z.literal('flow-delete'),
        flowId: z.string(),
        projectId: z.string(),
    }),
])

export const CopilotEventSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('text-delta'),
        delta: z.string(),
    }),
    z.object({
        type: z.literal('tool-call-start'),
        toolCallId: z.string(),
        name: z.string(),
        args: z.unknown(),
    }),
    z.object({
        type: z.literal('flow-updated'),
        toolCallId: z.string(),
        flowVersion: z.unknown(),
        inverse: AppliedInverseSchema,
    }),
    z.object({
        type: z.literal('flow-created'),
        toolCallId: z.string(),
        flowId: z.string(),
        flowVersionId: z.string(),
        inverse: AppliedInverseSchema,
    }),
    z.object({
        type: z.literal('tool-call-end'),
        toolCallId: z.string(),
        result: z.unknown().optional(),
        error: z.string().optional(),
    }),
    z.object({
        type: z.literal('summary'),
        scope: CopilotScopeSchema,
        text: z.string(),
        appliedCount: z.number(),
        questions: z.array(z.string()).optional(),
    }),
    z.object({
        type: z.literal('error'),
        message: z.string(),
    }),
    z.object({
        type: z.literal('done'),
        tokensUsed: z.number(),
        durationMs: z.number(),
    }),
])

export const CopilotSessionCreateRequestSchema = z.object({
    flowId: z.string(),
    selectedStepName: z.string().optional(),
})

export const CopilotSessionCreateResponseSchema = z.object({
    sessionId: z.string(),
    scope: CopilotScopeSchema,
    flowVersionId: z.string(),
})

export const CopilotMessageRequestSchema = z.object({
    message: z.string().min(1),
})

export const CopilotUndoRequestSchema = z.object({
    mode: z.enum(['copilot-only', 'reset-to-snapshot']),
})

export type CopilotScope = z.infer<typeof CopilotScopeSchema>
export type AppliedInverse =
    | { kind: 'flow-operation', op: FlowOperationRequest }
    | { kind: 'flow-delete', flowId: string, projectId: string }
export type CopilotEvent =
    | { type: 'text-delta', delta: string }
    | { type: 'tool-call-start', toolCallId: string, name: string, args: unknown }
    | { type: 'flow-updated', toolCallId: string, flowVersion: FlowVersion, inverse: AppliedInverse }
    | { type: 'flow-created', toolCallId: string, flowId: string, flowVersionId: string, inverse: AppliedInverse }
    | { type: 'tool-call-end', toolCallId: string, result?: unknown, error?: string }
    | { type: 'summary', scope: CopilotScope, text: string, appliedCount: number, questions?: string[] }
    | { type: 'error', message: string }
    | { type: 'done', tokensUsed: number, durationMs: number }
export type CopilotSessionCreateRequest = z.infer<typeof CopilotSessionCreateRequestSchema>
export type CopilotSessionCreateResponse = z.infer<typeof CopilotSessionCreateResponseSchema>
export type CopilotMessageRequest = z.infer<typeof CopilotMessageRequestSchema>
export type CopilotUndoRequest = z.infer<typeof CopilotUndoRequestSchema>
