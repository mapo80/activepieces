import { z } from 'zod'
import { STEP_NAME_REGEX } from '../../../core/common'
import { SampleDataSetting } from '../sample-data'

// NOTE: shape of `branches[].conditions` mirrors ROUTER's BranchCondition.
// We keep the validation lazy (z.unknown() wrapper) to avoid a circular
// import with action.ts. Runtime deep-validation happens in the engine
// via `evaluateConditions()` from router-executor, same entry-point as
// ROUTER uses.

export enum InteractiveFlowNodeType {
    TOOL = 'TOOL',
    USER_INPUT = 'USER_INPUT',
    CONFIRM = 'CONFIRM',
    BRANCH = 'BRANCH',
}

export const LocalizedStringSchema = z.record(
    z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'Invalid ISO locale code'),
    z.string(),
)
export type LocalizedString = z.infer<typeof LocalizedStringSchema>

export const InteractiveFlowStateFieldTypeSchema = z.enum([
    'string',
    'number',
    'boolean',
    'object',
    'array',
    'date',
])
export type InteractiveFlowStateFieldType = z.infer<typeof InteractiveFlowStateFieldTypeSchema>

export const InteractiveFlowStateFieldSchema = z.object({
    name: z.string().min(1),
    type: InteractiveFlowStateFieldTypeSchema,
    label: LocalizedStringSchema.optional(),
    description: z.string().optional(),
    format: z.string().optional(),
    extractable: z.boolean().optional(),
    sensitive: z.boolean().optional(),
    internal: z.boolean().optional(),
    minLength: z.number().int().min(1).max(200).optional(),
    maxLength: z.number().int().min(1).max(1000).optional(),
    pattern: z.string().optional(),
    enumFrom: z.string().optional(),
    enumValueField: z.string().optional(),
    parser: z.enum(['ndg', 'rapportoId', 'absolute-date', 'reason-code-cued', 'confirmation-keyword', 'ner-name']).optional(),
})
export type InteractiveFlowStateField = z.infer<typeof InteractiveFlowStateFieldSchema>

export const InteractiveFlowRenderHintSchema = z.object({
    component: z.string().min(1),
    props: z.record(z.string(), z.unknown()),
})
export type InteractiveFlowRenderHint = z.infer<typeof InteractiveFlowRenderHintSchema>

export const InteractiveFlowSummaryRowSchema = z.object({
    field: z.string().min(1),
    label: LocalizedStringSchema,
})
export type InteractiveFlowSummaryRow = z.infer<typeof InteractiveFlowSummaryRowSchema>

export const NodeMessageSchema = z.union([
    LocalizedStringSchema,
    z.object({
        dynamic: z.literal(true),
        systemPromptAddendum: z.string().optional(),
        fallback: LocalizedStringSchema.optional(),
    }),
])
export type NodeMessage = z.infer<typeof NodeMessageSchema>

export const ParamBindingSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('state'), field: z.string().min(1) }),
    z.object({ kind: z.literal('literal'), value: z.union([z.string(), z.number(), z.boolean(), z.null()]) }),
    z.object({ kind: z.literal('compose'), fields: z.array(z.string().min(1)).min(1) }),
])
export type ParamBinding = z.infer<typeof ParamBindingSchema>

export const InteractiveFlowErrorPolicySchema = z.object({
    onFailure: z.enum(['FAIL', 'SKIP', 'CONTINUE']),
    maxRetries: z.number().int().min(0).max(5).optional(),
    timeoutMs: z.number().int().min(1000).max(600_000).optional(),
})
export type InteractiveFlowErrorPolicy = z.infer<typeof InteractiveFlowErrorPolicySchema>

export const ToolInputSchemaSnapshotSchema = z.object({
    capturedAt: z.string(),
    gatewayId: z.string().min(1),
    schema: z.unknown(),
})
export type ToolInputSchemaSnapshot = z.infer<typeof ToolInputSchemaSnapshotSchema>

const NodeBaseSchema = {
    id: z.string().min(1),
    name: z.string().regex(STEP_NAME_REGEX),
    displayName: z.string(),
    stateInputs: z.array(z.string()),
    stateOutputs: z.array(z.string()),
}

export const InteractiveFlowToolNodeSchema = z.object({
    ...NodeBaseSchema,
    nodeType: z.literal(InteractiveFlowNodeType.TOOL),
    tool: z.string().min(1),
    toolParams: z.record(z.string(), ParamBindingSchema).optional(),
    toolInputSchemaSnapshot: ToolInputSchemaSnapshotSchema.optional(),
    outputMap: z.record(z.string(), z.string()).optional(),
    errorPolicy: InteractiveFlowErrorPolicySchema.optional(),
})
export type InteractiveFlowToolNode = z.infer<typeof InteractiveFlowToolNodeSchema>

export const InteractiveFlowUserInputNodeSchema = z.object({
    ...NodeBaseSchema,
    nodeType: z.literal(InteractiveFlowNodeType.USER_INPUT),
    message: NodeMessageSchema,
    render: InteractiveFlowRenderHintSchema,
})
export type InteractiveFlowUserInputNode = z.infer<typeof InteractiveFlowUserInputNodeSchema>

export const InteractiveFlowConfirmNodeSchema = z.object({
    ...NodeBaseSchema,
    nodeType: z.literal(InteractiveFlowNodeType.CONFIRM),
    message: NodeMessageSchema,
    summary: z.array(InteractiveFlowSummaryRowSchema).optional(),
    render: InteractiveFlowRenderHintSchema,
})
export type InteractiveFlowConfirmNode = z.infer<typeof InteractiveFlowConfirmNodeSchema>

export const InteractiveFlowBranchSchema = z.union([
    z.object({
        id: z.string().min(1),
        branchType: z.literal('CONDITION'),
        branchName: z.string(),
        conditions: z.array(z.array(z.unknown())),
        targetNodeIds: z.array(z.string()),
    }),
    z.object({
        id: z.string().min(1),
        branchType: z.literal('FALLBACK'),
        branchName: z.string(),
        targetNodeIds: z.array(z.string()),
    }),
])
export type InteractiveFlowBranch = z.infer<typeof InteractiveFlowBranchSchema>

export const InteractiveFlowBranchNodeSchema = z.object({
    ...NodeBaseSchema,
    nodeType: z.literal(InteractiveFlowNodeType.BRANCH),
    branches: z.array(InteractiveFlowBranchSchema).min(1),
})
export type InteractiveFlowBranchNode = z.infer<typeof InteractiveFlowBranchNodeSchema>

export const InteractiveFlowNodeSchema = z.discriminatedUnion('nodeType', [
    InteractiveFlowToolNodeSchema,
    InteractiveFlowUserInputNodeSchema,
    InteractiveFlowConfirmNodeSchema,
    InteractiveFlowBranchNodeSchema,
])
export type InteractiveFlowNode = z.infer<typeof InteractiveFlowNodeSchema>

export const InteractiveFlowPhaseSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    label: LocalizedStringSchema.optional(),
    nodeIds: z.array(z.string()).min(1),
    gate: z.string().optional(),
})
export type InteractiveFlowPhase = z.infer<typeof InteractiveFlowPhaseSchema>

export const FieldExtractorConfigSchema = z.object({
    aiProviderId: z.string().min(1),
    model: z.string().min(1),
})
export type FieldExtractorConfig = z.infer<typeof FieldExtractorConfigSchema>

export const QuestionGeneratorConfigSchema = z.object({
    aiProviderId: z.string().min(1),
    model: z.string().min(1),
    styleTemplate: z.string().optional(),
    historyWindow: z.number().int().min(0).max(50).optional(),
    maxResponseLength: z.number().int().min(50).max(2000).optional(),
})
export type QuestionGeneratorConfig = z.infer<typeof QuestionGeneratorConfigSchema>

export const InteractiveFlowActionSettings = z.object({
    sampleData: SampleDataSetting.optional(),
    customLogoUrl: z.string().optional(),
    nodes: z.array(InteractiveFlowNodeSchema),
    stateFields: z.array(InteractiveFlowStateFieldSchema),
    phases: z.array(InteractiveFlowPhaseSchema).optional(),
    greeting: LocalizedStringSchema.optional(),
    mcpGatewayId: z.string().optional(),
    systemPrompt: z.string().optional(),
    fieldExtractor: FieldExtractorConfigSchema.optional(),
    questionGenerator: QuestionGeneratorConfigSchema.optional(),
    locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).optional(),
    messageInput: z.string().optional(),
    sessionIdInput: z.string().optional(),
    sessionNamespace: z.string().optional(),
    cleanupOnSuccess: z.boolean().optional(),
    historyMaxTurns: z.number().int().min(1).max(100).optional(),
})
export type InteractiveFlowActionSettings = z.infer<typeof InteractiveFlowActionSettings>
