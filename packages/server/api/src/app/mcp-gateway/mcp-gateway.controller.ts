import {
    ApId,
    CreateMcpGatewayRequestSchema,
    ListMcpGatewayToolsResponseSchema,
    McpGatewayWithoutSensitiveDataSchema,
    PrincipalType,
    SERVICE_KEY_SECURITY_OPENAPI,
    UpdateMcpGatewayRequestSchema,
} from '@activepieces/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { z } from 'zod'
import { securityAccess } from '../core/security/authorization/fastify-security'
import { mcpGatewayService } from './mcp-gateway.service'

export const mcpGatewayController: FastifyPluginAsyncZod = async (app) => {
    app.post('/', CreateRoute, async (request, reply) => {
        const created = await mcpGatewayService(request.log).create({
            platformId: request.principal.platform.id,
            request: request.body,
        })
        await reply.status(StatusCodes.CREATED).send(created)
    })

    app.get('/', ListRoute, async (request) => {
        return mcpGatewayService(request.log).list({
            platformId: request.principal.platform.id,
        })
    })

    app.get('/:id', GetRoute, async (request) => {
        return mcpGatewayService(request.log).get({
            id: request.params.id,
            platformId: request.principal.platform.id,
        })
    })

    app.post('/:id', UpdateRoute, async (request) => {
        return mcpGatewayService(request.log).update({
            id: request.params.id,
            platformId: request.principal.platform.id,
            request: request.body,
        })
    })

    app.delete('/:id', DeleteRoute, async (request, reply) => {
        await mcpGatewayService(request.log).delete({
            id: request.params.id,
            platformId: request.principal.platform.id,
        })
        await reply.status(StatusCodes.NO_CONTENT).send()
    })

    app.post('/:id/tools', ListToolsRoute, async (request) => {
        return mcpGatewayService(request.log).listTools({
            id: request.params.id,
            platformId: request.principal.platform.id,
        })
    })
}

const AdminSecurity = {
    security: securityAccess.platformAdminOnly([PrincipalType.USER, PrincipalType.SERVICE]),
}

const CreateRoute = {
    config: AdminSecurity,
    schema: {
        tags: ['mcp-gateways'],
        body: CreateMcpGatewayRequestSchema,
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        response: {
            [StatusCodes.CREATED]: McpGatewayWithoutSensitiveDataSchema,
        },
    },
}

const ListRoute = {
    config: AdminSecurity,
    schema: {
        tags: ['mcp-gateways'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        response: {
            [StatusCodes.OK]: z.array(McpGatewayWithoutSensitiveDataSchema),
        },
    },
}

const IdParams = z.object({ id: ApId })

const GetRoute = {
    config: AdminSecurity,
    schema: {
        tags: ['mcp-gateways'],
        params: IdParams,
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        response: {
            [StatusCodes.OK]: McpGatewayWithoutSensitiveDataSchema,
        },
    },
}

const UpdateRoute = {
    config: AdminSecurity,
    schema: {
        tags: ['mcp-gateways'],
        params: IdParams,
        body: UpdateMcpGatewayRequestSchema,
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        response: {
            [StatusCodes.OK]: McpGatewayWithoutSensitiveDataSchema,
        },
    },
}

const DeleteRoute = {
    config: AdminSecurity,
    schema: {
        tags: ['mcp-gateways'],
        params: IdParams,
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        response: {
            [StatusCodes.NO_CONTENT]: z.never(),
        },
    },
}

const ListToolsRoute = {
    config: AdminSecurity,
    schema: {
        tags: ['mcp-gateways'],
        params: IdParams,
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        response: {
            [StatusCodes.OK]: ListMcpGatewayToolsResponseSchema,
        },
    },
}
