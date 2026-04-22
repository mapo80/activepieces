import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { copilotController } from './copilot-controller'
import { copilotCleanupJob } from './cleanup-job'

export const copilotModule: FastifyPluginAsyncTypebox = async (app) => {
    await app.register(copilotController, { prefix: '/v1/ai/copilot' })
    copilotCleanupJob.start(app.log)
    app.addHook('onClose', async () => {
        copilotCleanupJob.stop()
    })
}
