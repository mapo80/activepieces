import {
    ApId,
    assertNotNullOrUndefined,
    EnginePrincipal,
    ResolveMcpGatewayResponse,
    ResolveMcpGatewayResponseSchema,
} from '@activepieces/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { z } from 'zod'
import { securityAccess } from '../core/security/authorization/fastify-security'
import { buildRequestHeaders, mcpGatewayService } from './mcp-gateway.service'

export const mcpGatewayWorkerController: FastifyPluginAsyncZod = async (app) => {
    app.get('/:id/resolve', ResolveRoute, async (request): Promise<ResolveMcpGatewayResponse> => {
        const enginePrincipal = request.principal as EnginePrincipal
        assertNotNullOrUndefined(enginePrincipal.platform?.id, 'platformId')
        const gateway = await mcpGatewayService(request.log).getResolved({
            id: request.params.id,
            platformId: enginePrincipal.platform.id,
        })
        return {
            url: gateway.url,
            headers: buildRequestHeaders(gateway.auth),
        }
    })
}

const ResolveRoute = {
    config: {
        security: securityAccess.engine(),
    },
    schema: {
        params: z.object({ id: ApId }),
        response: {
            [StatusCodes.OK]: ResolveMcpGatewayResponseSchema,
        },
    },
}
