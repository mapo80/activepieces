import { FlowActionType, flowStructureUtil, FlowVersion, isNil } from '@activepieces/shared'
import { z } from 'zod'
import { CopilotContext, CopilotTool } from '../../scope-registry'

const Parameters = z.object({})

function findInteractiveFlowAction(flowVersion: FlowVersion): { name: string, settings: unknown } | null {
    const steps = flowStructureUtil.getAllSteps(flowVersion.trigger)
    const ifStep = steps.find((s) => s.type === FlowActionType.INTERACTIVE_FLOW)
    if (isNil(ifStep)) return null
    return { name: ifStep.name, settings: ifStep.settings }
}

export const readFlowSettingsTool: CopilotTool = {
    description: 'Reads the current interactive-flow step settings (nodes, state fields, system prompt, message bindings). Call this first to understand what already exists before proposing modifications.',
    parameters: Parameters,
    isMutation: false,
    execute: async (_args, ctx: CopilotContext) => {
        const found = findInteractiveFlowAction(ctx.flowVersion)
        if (isNil(found)) {
            return { hasInteractiveFlowAction: false }
        }
        return {
            hasInteractiveFlowAction: true,
            stepName: found.name,
            settings: found.settings,
        }
    },
}

export const readFlowSettings = {
    findInteractiveFlowAction,
}
