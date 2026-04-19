import { z } from 'zod'
import { STEP_NAME_REGEX } from '../../../core/common'
import { SampleDataSetting } from '../sample-data'

export enum InteractiveFlowNodeType {
    TOOL = 'TOOL',
    USER_INPUT = 'USER_INPUT',
    CONFIRM = 'CONFIRM',
}

const InteractiveFlowRenderHint = z.object({
    component: z.string(),
    props: z.record(z.string(), z.unknown()),
})

const InteractiveFlowSummaryField = z.object({
    label: z.string(),
    field: z.string(),
})

export const InteractiveFlowNodeSchema = z.object({
    id: z.string(),
    name: z.string().regex(STEP_NAME_REGEX),
    displayName: z.string(),
    nodeType: z.enum([InteractiveFlowNodeType.TOOL, InteractiveFlowNodeType.USER_INPUT, InteractiveFlowNodeType.CONFIRM]),
    stateInputs: z.array(z.string()),
    stateOutputs: z.array(z.string()),
    tool: z.string().optional(),
    toolParams: z.record(z.string(), z.string()).optional(),
    render: InteractiveFlowRenderHint.optional(),
    message: z.string().optional(),
    selectField: z.string().optional(),
    summary: z.array(InteractiveFlowSummaryField).optional(),
})

export const InteractiveFlowStateFieldSchema = z.object({
    name: z.string(),
    type: z.enum(['string', 'number', 'object', 'array']),
    label: z.string().optional(),
    description: z.string().optional(),
    extractable: z.boolean().optional(),
    internal: z.boolean().optional(),
})

const FieldExtractorConfig = z.object({
    enabled: z.boolean(),
    model: z.string(),
})

export const InteractiveFlowActionSettings = z.object({
    sampleData: SampleDataSetting.optional(),
    customLogoUrl: z.string().optional(),
    nodes: z.array(InteractiveFlowNodeSchema),
    stateFields: z.array(InteractiveFlowStateFieldSchema),
    greeting: z.string().optional(),
    mcpGatewayId: z.string().optional(),
    fieldExtractor: FieldExtractorConfig.optional(),
})

export type InteractiveFlowActionSettings = z.infer<typeof InteractiveFlowActionSettings>
export type InteractiveFlowNode = z.infer<typeof InteractiveFlowNodeSchema>
export type InteractiveFlowStateField = z.infer<typeof InteractiveFlowStateFieldSchema>
