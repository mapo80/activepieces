import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { copilotController } from './copilot-controller'
import { copilotCleanupJob } from './cleanup-job'

export const copilotModule: FastifyPluginAsyncZod = async (app) => {
    await app.register(copilotController, { prefix: '/v1/ai/copilot' })
    copilotCleanupJob.start(app.log)
    app.addHook('onClose', async () => {
        copilotCleanupJob.stop()
    })
}
