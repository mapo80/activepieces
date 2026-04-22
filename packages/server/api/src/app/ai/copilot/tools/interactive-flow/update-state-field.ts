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
    name: z.string().min(1),
    patch: z.record(z.string(), z.unknown()).describe('Partial state-field updates to merge into the existing field (e.g. {label:{it:"rapporto"}, pattern:"^..." }).'),
})

export const updateStateFieldTool: CopilotTool = {
    description: 'Updates an existing state field by merging the provided patch.',
    parameters: Parameters,
    isMutation: true,
    execute: async (rawArgs, ctx: CopilotContext): Promise<{ op: FlowOperationRequest }> => {
        const args = Parameters.parse(rawArgs)
        const steps = flowStructureUtil.getAllSteps(ctx.flowVersion.trigger)
        const ifStep = steps.find((s) => s.type === FlowActionType.INTERACTIVE_FLOW) as InteractiveFlowAction | undefined
        if (isNil(ifStep)) throw new Error('No INTERACTIVE_FLOW action present.')
        const fields = ifStep.settings.stateFields ?? []
        const idx = fields.findIndex((f) => f.name === args.name)
        if (idx === -1) throw new Error(`State field "${args.name}" not found.`)
        const updated = { ...fields[idx], ...(args.patch as Record<string, unknown>) }
        const nextFields = [...fields]
        nextFields[idx] = updated as typeof fields[number]
        return {
            op: {
                type: FlowOperationType.UPDATE_ACTION,
                request: {
                    ...ifStep,
                    settings: { ...ifStep.settings, stateFields: nextFields },
                },
            } as FlowOperationRequest,
        }
    },
}
