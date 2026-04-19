import {
    assertNotNullOrUndefined,
    EnginePrincipal,
    InteractiveFlowNodeStateEvent,
    WebsocketClientEvent,
} from '@activepieces/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { securityAccess } from '../../core/security/authorization/fastify-security'
import { websocketService } from '../../core/websockets.service'

export const interactiveFlowEventsController: FastifyPluginAsyncZod = async (app) => {
    app.post('/', EmitRoute, async (request, reply) => {
        const enginePrincipal = request.principal as EnginePrincipal
        assertNotNullOrUndefined(enginePrincipal.projectId, 'projectId')
        const event: InteractiveFlowNodeStateEvent = request.body
        websocketService.to(enginePrincipal.projectId).emit(WebsocketClientEvent.INTERACTIVE_FLOW_NODE_STATE, event)
        await reply.code(StatusCodes.NO_CONTENT).send()
    })
}

const EmitRoute = {
    config: {
        security: securityAccess.engine(),
    },
    schema: {
        body: InteractiveFlowNodeStateEvent,
        response: {
            [StatusCodes.NO_CONTENT]: undefined,
        },
    },
}
