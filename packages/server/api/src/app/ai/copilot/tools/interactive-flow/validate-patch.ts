import { z } from 'zod'
import {
    FlowActionType,
    flowStructureUtil,
    InteractiveFlowAction,
    isNil,
} from '@activepieces/shared'
import { CopilotContext, CopilotTool } from '../../scope-registry'
import { validateInteractiveFlow } from '../../../../flows/flow-version/interactive-flow-validator'

const Parameters = z.object({})

export const validatePatchTool: CopilotTool = {
    description: 'Validates the current INTERACTIVE_FLOW settings (after the modifications staged so far). Returns any schema errors, orphan inputs, duplicate outputs, cycles. Call this before finalize.',
    parameters: Parameters,
    isMutation: false,
    execute: async (_args, ctx: CopilotContext) => {
        const steps = flowStructureUtil.getAllSteps(ctx.flowVersion.trigger)
        const ifStep = steps.find((s) => s.type === FlowActionType.INTERACTIVE_FLOW) as InteractiveFlowAction | undefined
        if (isNil(ifStep)) {
            return { valid: false, errors: [{ message: 'No INTERACTIVE_FLOW action present.' }] }
        }
        const result = validateInteractiveFlow(ifStep.settings)
        return result
    },
}
