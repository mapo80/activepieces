import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { toolsInvokeController } from './tools-invoke-controller'

export const agenticModule: FastifyPluginAsyncZod = async (app) => {
    await app.register(toolsInvokeController, { prefix: '/agentic/v1' })
}
