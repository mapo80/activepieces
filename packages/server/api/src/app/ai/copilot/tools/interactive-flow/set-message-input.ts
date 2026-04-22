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

const Parameters = z.object({
    messageInput: z.string().optional().describe('Expression binding the user message to the trigger, typically "{{trigger.message}}".'),
    sessionIdInput: z.string().optional().describe('Expression binding the session id, typically "{{trigger.sessionId}}".'),
    sessionNamespace: z.string().optional().describe('Namespace for cross-step session sharing.'),
    locale: z.string().optional().describe('Locale code like "it" or "en".'),
    mcpGatewayId: z.string().optional().describe('MCP gateway id to bind to tool nodes.'),
})

export const setMessageInputTool: CopilotTool = {
    description: 'Sets one or more top-level INTERACTIVE_FLOW settings: messageInput / sessionIdInput / sessionNamespace / locale / mcpGatewayId.',
    parameters: Parameters,
    isMutation: true,
    execute: async (rawArgs, ctx: CopilotContext): Promise<{ op: FlowOperationRequest }> => {
        const args = Parameters.parse(rawArgs)
        const steps = flowStructureUtil.getAllSteps(ctx.flowVersion.trigger)
        const ifStep = steps.find((s) => s.type === FlowActionType.INTERACTIVE_FLOW) as InteractiveFlowAction | undefined
        if (isNil(ifStep)) throw new Error('No INTERACTIVE_FLOW action present.')
        const nextSettings = { ...ifStep.settings }
        if (args.messageInput !== undefined) nextSettings.messageInput = args.messageInput
        if (args.sessionIdInput !== undefined) nextSettings.sessionIdInput = args.sessionIdInput
        if (args.sessionNamespace !== undefined) nextSettings.sessionNamespace = args.sessionNamespace
        if (args.locale !== undefined) nextSettings.locale = args.locale
        if (args.mcpGatewayId !== undefined) nextSettings.mcpGatewayId = args.mcpGatewayId
        return {
            op: {
                type: FlowOperationType.UPDATE_ACTION,
                request: { ...ifStep, settings: nextSettings },
            } as FlowOperationRequest,
        }
    },
}
