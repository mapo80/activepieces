import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { copilotController } from './copilot-controller'
import { copilotCleanupJob } from './cleanup-job'
import { copilotDevToggleController } from './dev-toggle-controller'

export const copilotModule: FastifyPluginAsyncZod = async (app) => {
    await app.register(copilotController, { prefix: '/v1/ai/copilot' })
    await app.register(copilotDevToggleController, { prefix: '/v1/ai/copilot-dev' })
    copilotCleanupJob.start(app.log)
    app.addHook('onClose', async () => {
        copilotCleanupJob.stop()
    })
}
