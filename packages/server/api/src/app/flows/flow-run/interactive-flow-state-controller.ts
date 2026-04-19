import {
    ApId,
    FlowActionType,
    Permission,
    PrincipalType,
    SERVICE_KEY_SECURITY_OPENAPI,
} from '@activepieces/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { z } from 'zod'
import { EntitySourceType, ProjectResourceType } from '../../core/security/authorization/common'
import { securityAccess } from '../../core/security/authorization/fastify-security'
import { FlowRunEntity } from './flow-run-entity'
import { flowRunService } from './flow-run-service'

type InteractiveFlowNodeStatus = 'executed' | 'paused' | 'failed' | 'skipped'

type InteractiveFlowStateResponse = {
    flowRunId: string
    status: string
    steps: Array<{
        stepName: string
        status: string
        state: Record<string, unknown>
        executedNodeIds: string[]
        currentNodeId?: string
        nodeStatuses: Record<string, InteractiveFlowNodeStatus>
    }>
}

const InteractiveFlowStateResponseSchema = z.object({
    flowRunId: z.string(),
    status: z.string(),
    steps: z.array(z.object({
        stepName: z.string(),
        status: z.string(),
        state: z.record(z.string(), z.unknown()),
        executedNodeIds: z.array(z.string()),
        currentNodeId: z.string().optional(),
        nodeStatuses: z.record(z.string(), z.enum(['executed', 'paused', 'failed', 'skipped'])),
    })),
})

export const interactiveFlowStateController: FastifyPluginAsyncZod = async (app) => {
    app.get('/:id/interactive-flow-state', StateRoute, async (request): Promise<InteractiveFlowStateResponse> => {
        const run = await flowRunService(request.log).getOnePopulatedOrThrow({
            id: request.params.id,
            projectId: request.projectId,
        })

        const steps = Object.entries(run.steps ?? {})
            .filter(([, step]) => step.type === FlowActionType.INTERACTIVE_FLOW)
            .map(([stepName, step]) => {
                const output = (step.output ?? {}) as {
                    state?: Record<string, unknown>
                    executedNodeIds?: string[]
                    currentNodeId?: string
                    skippedNodeIds?: string[]
                    failedNodeId?: string
                }
                const executedNodeIds = output.executedNodeIds ?? []
                const skippedNodeIds = output.skippedNodeIds ?? []
                const nodeStatuses: Record<string, InteractiveFlowNodeStatus> = {}
                for (const nodeId of executedNodeIds) nodeStatuses[nodeId] = 'executed'
                for (const nodeId of skippedNodeIds) nodeStatuses[nodeId] = 'skipped'
                if (output.failedNodeId) nodeStatuses[output.failedNodeId] = 'failed'
                if (output.currentNodeId) nodeStatuses[output.currentNodeId] = 'paused'
                return {
                    stepName,
                    status: step.status,
                    state: output.state ?? {},
                    executedNodeIds,
                    currentNodeId: output.currentNodeId,
                    nodeStatuses,
                }
            })

        return {
            flowRunId: run.id,
            status: run.status,
            steps,
        }
    })
}

const StateRoute = {
    config: {
        security: securityAccess.project(
            [PrincipalType.USER, PrincipalType.SERVICE],
            Permission.READ_FLOW,
            {
                type: ProjectResourceType.TABLE,
                tableName: FlowRunEntity,
                entitySourceType: EntitySourceType.PARAM,
                lookup: { paramKey: 'id', entityField: 'projectId' },
            },
        ),
    },
    schema: {
        params: z.object({ id: ApId }),
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        response: {
            [StatusCodes.OK]: InteractiveFlowStateResponseSchema,
        },
    },
}
