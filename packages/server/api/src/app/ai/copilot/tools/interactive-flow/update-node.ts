import {
    FlowActionType,
    FlowOperationRequest,
    FlowOperationType,
    flowStructureUtil,
    InteractiveFlowAction,
    isNil,
} from '@activepieces/shared'
import { z } from 'zod'
import { CopilotContext, CopilotTool } from '../../scope-registry'

const Parameters = z.object({
    name: z.string().min(1).describe('The name of the node to update.'),
    patch: z.record(z.string(), z.unknown()).describe('Partial node updates to merge into the existing node (e.g. {stateInputs:["closureReasons"], stateOutputs:["closureReasonCode"]}).'),
})

export const updateNodeTool: CopilotTool = {
    description: 'Updates an existing node by merging the provided patch. Use to fix stateInputs, stateOutputs, render, singleOptionStrategy, tool, toolParams, or message on an already-added node.',
    parameters: Parameters,
    isMutation: true,
    execute: async (rawArgs, ctx: CopilotContext): Promise<{ op: FlowOperationRequest }> => {
        const args = Parameters.parse(rawArgs)
        const steps = flowStructureUtil.getAllSteps(ctx.flowVersion.trigger)
        const ifStep = steps.find((s) => s.type === FlowActionType.INTERACTIVE_FLOW) as InteractiveFlowAction | undefined
        if (isNil(ifStep)) throw new Error('No INTERACTIVE_FLOW action present.')
        const nodes = ifStep.settings.nodes ?? []
        const idx = nodes.findIndex((n) => n.name === args.name)
        if (idx === -1) throw new Error(`Node "${args.name}" not found.`)
        const updated = { ...nodes[idx], ...(args.patch as Record<string, unknown>) }
        const nextNodes = [...nodes]
        nextNodes[idx] = updated as typeof nodes[number]
        return {
            op: {
                type: FlowOperationType.UPDATE_ACTION,
                request: {
                    ...ifStep,
                    settings: { ...ifStep.settings, nodes: nextNodes },
                },
            } as FlowOperationRequest,
        }
    },
}
