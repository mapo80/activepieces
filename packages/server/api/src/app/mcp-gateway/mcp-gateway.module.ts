import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { mcpGatewayController } from './mcp-gateway.controller'

export const mcpGatewayModule: FastifyPluginAsyncZod = async (app) => {
    await app.register(mcpGatewayController, { prefix: '/v1/mcp-gateways' })
}
