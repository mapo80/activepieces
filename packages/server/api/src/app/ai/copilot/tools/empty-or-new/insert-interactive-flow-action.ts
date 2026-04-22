import { z } from 'zod'
import {
    FlowOperationRequest,
    FlowOperationType,
    FlowActionType,
    InteractiveFlowActionSettings,
    isNil,
} from '@activepieces/shared'
import { CopilotContext, CopilotTool } from '../../scope-registry'

const Parameters = z.object({
    name: z.string().min(1).describe('Machine name of the interactive-flow action (e.g. "interactive_flow").'),
    displayName: z.string().min(1).describe('Display name (e.g. "Estinzione").'),
})

const EMPTY_IF_SETTINGS: InteractiveFlowActionSettings = {
    nodes: [],
    stateFields: [],
    messageInput: '{{trigger.message}}',
    sessionIdInput: '{{trigger.sessionId}}',
    locale: 'it',
} as InteractiveFlowActionSettings

export const insertInteractiveFlowActionTool: CopilotTool = {
    description: 'Inserts an empty INTERACTIVE_FLOW action as the first child of the trigger. Use when the flow is empty (trigger-only) and you need to scaffold the interactive flow before adding fields and nodes.',
    parameters: Parameters,
    isMutation: true,
    execute: async (rawArgs, ctx: CopilotContext): Promise<{ op: FlowOperationRequest }> => {
        const args = Parameters.parse(rawArgs)
        const trigger = ctx.flowVersion.trigger
        if (!isNil(trigger.nextAction)) {
            throw new Error('Trigger already has a nextAction. Cannot insert interactive-flow as first action.')
        }
        return {
            op: {
                type: FlowOperationType.ADD_ACTION,
                request: {
                    parentStep: trigger.name,
                    action: {
                        type: FlowActionType.INTERACTIVE_FLOW,
                        name: args.name,
                        displayName: args.displayName,
                        settings: EMPTY_IF_SETTINGS,
                        valid: true,
                    },
                },
            } as FlowOperationRequest,
        }
    },
}
