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
    text: z.string().min(1).describe('The system prompt text for the AI field extractor (in the flow\'s locale).'),
})

export const setSystemPromptTool: CopilotTool = {
    description: 'Sets the systemPrompt used by the INTERACTIVE_FLOW AI field extractor.',
    parameters: Parameters,
    isMutation: true,
    execute: async (rawArgs, ctx: CopilotContext): Promise<{ op: FlowOperationRequest }> => {
        const args = Parameters.parse(rawArgs)
        const steps = flowStructureUtil.getAllSteps(ctx.flowVersion.trigger)
        const ifStep = steps.find((s) => s.type === FlowActionType.INTERACTIVE_FLOW) as InteractiveFlowAction | undefined
        if (isNil(ifStep)) throw new Error('No INTERACTIVE_FLOW action present.')
        return {
            op: {
                type: FlowOperationType.UPDATE_ACTION,
                request: {
                    ...ifStep,
                    settings: { ...ifStep.settings, systemPrompt: args.text },
                },
            } as FlowOperationRequest,
        }
    },
}
