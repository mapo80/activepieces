import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { copilotCleanupJob } from './cleanup-job'
import { copilotController } from './copilot-controller'
import { copilotDevToggleController } from './dev-toggle-controller'

export const copilotModule: FastifyPluginAsyncZod = async (app) => {
    await app.register(copilotController, { prefix: '/v1/ai/copilot' })
    await app.register(copilotDevToggleController, { prefix: '/v1/ai/copilot-dev' })
    copilotCleanupJob.start(app.log)
    app.addHook('onClose', async () => {
        copilotCleanupJob.stop()
    })
}
