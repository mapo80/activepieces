import {
    FlowActionType,
    FlowOperationRequest,
    FlowOperationType,
    flowStructureUtil,
    InteractiveFlowAction,
    InteractiveFlowNode,
    isNil,
} from '@activepieces/shared'
import { z } from 'zod'
import { CopilotContext, CopilotTool } from '../../scope-registry'

const Parameters = z.object({
    id: z.string().min(1).describe('Unique id for the node within the flow (e.g. "search_customer").'),
    name: z.string().min(1).describe('Machine name (camelCase or snake_case).'),
    displayName: z.string().min(1).describe('Display name shown in the designer.'),
    nodeType: z.enum(['TOOL', 'USER_INPUT', 'CONFIRM', 'BRANCH']),
    stateInputs: z.array(z.string()).default([]).describe('State fields this node consumes.'),
    stateOutputs: z.array(z.string()).default([]).describe('State fields this node produces.'),
    tool: z.string().optional().describe('For TOOL nodes: the MCP tool name like "banking-customers/search_customer" (obtained via list_mcp_tools).'),
    toolParams: z.record(z.string(), z.unknown()).optional().describe('For TOOL nodes: object describing how to build call params from state.'),
    singleOptionStrategy: z.enum(['list', 'confirm', 'auto']).optional().describe('For USER_INPUT nodes: how to handle single-match options. "auto" skips the prompt.'),
    render: z.record(z.string(), z.unknown()).optional().describe('Render component config for USER_INPUT/CONFIRM nodes (e.g. {component:"DataTable", props:{sourceField:"accounts", columns:[...]}}).'),
    message: z.record(z.string(), z.unknown()).optional().describe('Message config. For dynamic LLM-generated prompts use {dynamic:true, fallback:{it:"..."}, systemPromptAddendum:"..."}. For static: {text:{it:"..."}}.'),
    allowedExtraFields: z.array(z.string()).optional().describe('Extra state fields accepted in addition to stateOutputs at this pause.'),
})

export const addNodeTool: CopilotTool = {
    description: 'Adds a new node to the INTERACTIVE_FLOW. Nodes are appended at the end of the nodes array, which must be topologically valid (inputs must come from earlier nodes).',
    parameters: Parameters,
    isMutation: true,
    execute: async (rawArgs, ctx: CopilotContext): Promise<{ op: FlowOperationRequest }> => {
        const args = Parameters.parse(rawArgs)
        const steps = flowStructureUtil.getAllSteps(ctx.flowVersion.trigger)
        const ifStep = steps.find((s) => s.type === FlowActionType.INTERACTIVE_FLOW) as InteractiveFlowAction | undefined
        if (isNil(ifStep)) throw new Error('No INTERACTIVE_FLOW action present.')
        const existingNodes = ifStep.settings.nodes ?? []
        if (existingNodes.some((n) => n.id === args.id || n.name === args.name)) {
            throw new Error(`Node with id or name "${args.id}/${args.name}" already exists.`)
        }
        const newNode = {
            id: args.id,
            name: args.name,
            displayName: args.displayName,
            nodeType: args.nodeType,
            stateInputs: args.stateInputs,
            stateOutputs: args.stateOutputs,
            ...(args.tool ? { tool: args.tool } : {}),
            ...(args.toolParams ? { toolParams: args.toolParams } : {}),
            ...(args.singleOptionStrategy ? { singleOptionStrategy: args.singleOptionStrategy } : {}),
            ...(args.render ? { render: args.render } : {}),
            ...(args.message ? { message: args.message } : {}),
            ...(args.allowedExtraFields ? { allowedExtraFields: args.allowedExtraFields } : {}),
        } as unknown as InteractiveFlowNode
        return {
            op: {
                type: FlowOperationType.UPDATE_ACTION,
                request: {
                    ...ifStep,
                    settings: {
                        ...ifStep.settings,
                        nodes: [...existingNodes, newNode],
                    },
                },
            } as FlowOperationRequest,
        }
    },
}
