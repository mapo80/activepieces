import { z } from 'zod'
import {
    FlowActionType,
    FlowOperationRequest,
    FlowOperationType,
    flowStructureUtil,
    InteractiveFlowAction,
    isNil,
} from '@activepieces/shared'
import { CopilotContext, CopilotTool } from '../../scope-registry'

const StateFieldSchema = z.object({
    name: z.string().min(1),
    type: z.enum(['string', 'number', 'boolean', 'object', 'array']),
    extractable: z.boolean(),
    description: z.string().min(1),
    labelIt: z.string().optional(),
    labelEn: z.string().optional(),
    enumFrom: z.string().optional(),
    enumValueField: z.string().optional(),
    pattern: z.string().optional(),
    parser: z.enum(['ndg', 'rapportoId', 'absolute-date', 'reason-code-cued', 'confirmation-keyword', 'ner-name']).optional(),
    extractionScope: z.enum(['global', 'node-local']).optional(),
})

const NodeSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    displayName: z.string().min(1),
    nodeType: z.enum(['TOOL', 'USER_INPUT', 'CONFIRM', 'BRANCH']),
    stateInputs: z.array(z.string()).default([]),
    stateOutputs: z.array(z.string()).default([]),
    tool: z.string().optional(),
    toolParams: z.record(z.string(), z.unknown()).optional(),
    singleOptionStrategy: z.enum(['list', 'confirm', 'auto']).optional(),
    render: z.record(z.string(), z.unknown()).optional(),
    message: z.record(z.string(), z.unknown()).optional(),
    allowedExtraFields: z.array(z.string()).optional(),
})

const Parameters = z.object({
    systemPrompt: z.string().min(10).describe('Full systemPrompt text for the field extractor.'),
    messageInput: z.string().default('{{trigger.message}}'),
    sessionIdInput: z.string().default('{{trigger.sessionId}}'),
    sessionNamespace: z.string().optional(),
    locale: z.string().default('it'),
    mcpGatewayId: z.string().optional(),
    stateFields: z.array(StateFieldSchema).min(1).describe('ALL state fields the flow uses, in topological order.'),
    nodes: z.array(NodeSchema).min(1).describe('ALL nodes, in topological order.'),
})

type Args = z.infer<typeof Parameters>

function buildLabel(f: z.infer<typeof StateFieldSchema>): Record<string, string> | undefined {
    if (!f.labelIt && !f.labelEn) return undefined
    return { it: f.labelIt ?? f.name, en: f.labelEn ?? f.name }
}

function buildSettings(args: Args, prev: InteractiveFlowAction['settings']): InteractiveFlowAction['settings'] {
    const stateFields = args.stateFields.map((f) => {
        const field = {
            name: f.name,
            type: f.type,
            extractable: f.extractable,
            description: f.description,
        } as Record<string, unknown>
        const label = buildLabel(f)
        if (label) field.label = label
        if (f.enumFrom) field.enumFrom = f.enumFrom
        if (f.enumValueField) field.enumValueField = f.enumValueField
        if (f.pattern) field.pattern = f.pattern
        if (f.parser) field.parser = f.parser
        if (f.extractionScope) field.extractionScope = f.extractionScope
        return field
    })
    const nodes = args.nodes.map((n) => {
        const node = {
            id: n.id,
            name: n.name,
            displayName: n.displayName,
            nodeType: n.nodeType,
            stateInputs: n.stateInputs,
            stateOutputs: n.stateOutputs,
        } as Record<string, unknown>
        if (n.tool) node.tool = n.tool
        if (n.toolParams) node.toolParams = n.toolParams
        if (n.singleOptionStrategy) node.singleOptionStrategy = n.singleOptionStrategy
        if (n.render) node.render = n.render
        if (n.message) node.message = n.message
        if (n.allowedExtraFields) node.allowedExtraFields = n.allowedExtraFields
        return node
    })
    return {
        ...prev,
        systemPrompt: args.systemPrompt,
        messageInput: args.messageInput,
        sessionIdInput: args.sessionIdInput,
        sessionNamespace: args.sessionNamespace ?? prev.sessionNamespace,
        locale: args.locale,
        mcpGatewayId: args.mcpGatewayId ?? prev.mcpGatewayId,
        stateFields,
        nodes,
    } as InteractiveFlowAction['settings']
}

export const scaffoldSettingsTool: CopilotTool = {
    description: 'BULK: sets ALL INTERACTIVE_FLOW settings in a single call (systemPrompt + messageInput + sessionIdInput + locale + mcpGatewayId + stateFields[] + nodes[]). Call this INSTEAD of many add_state_field / add_node calls when you already know the complete flow structure. The current state fields and nodes are REPLACED. Always prefer this over 20+ sequential tool-calls.',
    parameters: Parameters,
    isMutation: true,
    execute: async (rawArgs, ctx: CopilotContext): Promise<{ op: FlowOperationRequest }> => {
        const args = Parameters.parse(rawArgs)
        const steps = flowStructureUtil.getAllSteps(ctx.flowVersion.trigger)
        const ifStep = steps.find((s) => s.type === FlowActionType.INTERACTIVE_FLOW) as InteractiveFlowAction | undefined
        if (isNil(ifStep)) {
            throw new Error('No INTERACTIVE_FLOW action present. Call insert_interactive_flow_action first.')
        }
        const nextSettings = buildSettings(args, ifStep.settings)
        return {
            op: {
                type: FlowOperationType.UPDATE_ACTION,
                request: {
                    ...ifStep,
                    settings: nextSettings,
                },
            } as FlowOperationRequest,
        }
    },
}
