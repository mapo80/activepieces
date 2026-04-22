import { z } from 'zod'
import { FastifyBaseLogger } from 'fastify'
import { CopilotContext, CopilotTool } from '../../scope-registry'
import { flowService } from '../../../../flows/flow/flow.service'

const Parameters = z.object({
    displayName: z.string().min(1).describe('Human-friendly name of the new flow.'),
})

export function buildCreateNewFlowTool(log: FastifyBaseLogger): CopilotTool {
    return {
        description: 'Creates a NEW flow in the current project. Use only when the user explicitly asks to create a brand new flow. Returns the new flowId and flowVersionId.',
        parameters: Parameters,
        isMutation: true,
        execute: async (rawArgs, ctx: CopilotContext) => {
            const args = Parameters.parse(rawArgs)
            const svc = flowService(log)
            const flow = await svc.create({
                projectId: ctx.projectId,
                request: { displayName: args.displayName, projectId: ctx.projectId },
            })
            return {
                _createdFlow: true,
                flowId: flow.id,
                flowVersionId: flow.version.id,
            }
        },
    }
}
