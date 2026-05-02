import { ALL_PRINCIPAL_TYPES, ApId, CreateWaitpointRequest, CreateWaitpointResponse } from '@activepieces/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { z } from 'zod'
import { securityAccess } from '../../../core/security/authorization/fastify-security'
import { domainHelper } from '../../../ee/custom-domains/domain-helper'
import { waitpointService } from './waitpoint-service'

export const waitpointController: FastifyPluginAsyncZod = async (app) => {
    app.get('/by-run/:flowRunId', GetWaitpointByRunParams, async (request) => {
        const waitpoint = await waitpointService(request.log).getByFlowRunId(request.params.flowRunId)
        return { waitpoint }
    })

    app.post('/', CreateWaitpointParams, async (request, reply) => {
        const { flowRunId, projectId, stepName, type, version, resumeDateTime, responseToSend, workerHandlerId, httpRequestId } = request.body
        const { waitpoint } = await waitpointService(request.log).createForPause({
            flowRunId,
            projectId,
            stepName,
            type,
            version,
            resumeDateTime,
            responseToSend: responseToSend ?? undefined,
            workerHandlerId: workerHandlerId ?? undefined,
            httpRequestId: httpRequestId ?? undefined,
        })
        const resumeUrl = await domainHelper.getPublicApiUrl({
            path: `v1/flow-runs/${flowRunId}/waitpoints/${waitpoint.id}`,
        })
        return reply.status(StatusCodes.CREATED).send({
            id: waitpoint.id,
            resumeUrl,
        })
    })
}

const CreateWaitpointParams = {
    config: {
        security: securityAccess.engine(),
    },
    schema: {
        body: CreateWaitpointRequest,
        response: {
            [StatusCodes.CREATED]: CreateWaitpointResponse,
        },
    },
}

const GetWaitpointByRunParams = {
    config: {
        security: securityAccess.unscoped(ALL_PRINCIPAL_TYPES),
    },
    schema: {
        params: z.object({
            flowRunId: ApId,
        }),
    },
}
