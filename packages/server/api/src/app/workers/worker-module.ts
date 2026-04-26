import { WebsocketClientEvent } from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { aiProviderWorkerController } from '../ai/ai-provider-worker.controller'
import { commandLayerController, overrideProviderAdapter } from '../ai/command-layer/command-layer.controller'
import { lockRecoveryDaemon } from '../ai/command-layer/lock-recovery'
import { outboxPublisher } from '../ai/command-layer/outbox-publisher'
import { VercelAIAdapter } from '../ai/command-layer/vercel-ai-adapter'
import { interactiveFlowAiController } from '../ai/interactive-flow-ai.controller'
import { websocketService } from '../core/websockets.service'
import { runsMetadataQueue } from '../flows/flow-run/flow-runs-queue'
import { interactiveFlowEventsController } from '../flows/flow-run/interactive-flow-events-controller'
import { pubsub } from '../helper/pubsub'
import { mcpGatewayWorkerController } from '../mcp-gateway/mcp-gateway-worker.controller'
import { flowEngineWorker } from './engine-controller'
import { setupBullMQBoard } from './job-queue/bullboard'
import { jobBroker } from './job-queue/job-broker'
import { jobQueue } from './job-queue/job-queue'
import { workerMachineController } from './machine/machine-controller'
import { queueMigration } from './migrations/queue-migration-runner'
export const workerModule: FastifyPluginAsyncZod = async (app) => {
    await app.register(flowEngineWorker, {
        prefix: '/v1/engine',
    })
    await app.register(mcpGatewayWorkerController, {
        prefix: '/v1/engine/mcp-gateways',
    })
    await app.register(aiProviderWorkerController, {
        prefix: '/v1/engine/ai-providers',
    })
    await app.register(interactiveFlowAiController, {
        prefix: '/v1/engine/interactive-flow-ai',
    })
    await app.register(commandLayerController, {
        prefix: '/v1/engine/interactive-flow-ai/command-layer',
    })
    await app.register(interactiveFlowEventsController, {
        prefix: '/v1/engine/interactive-flow-events',
    })
    await app.register(workerMachineController, {
        prefix: '/v1/worker-machines',
    })
    await jobQueue(app.log).init()

    await runsMetadataQueue(app.log).init()

    await setupBullMQBoard(app)

    if (process.env.AP_LLM_VIA_BRIDGE === 'true') {
        const modelHint = process.env.AP_COMMAND_LAYER_MODEL ?? 'claude-sonnet-4-6'
        const baseURL = process.env.OPENAI_BASE_URL ?? 'http://localhost:8787/v1'
        const apiKey = process.env.OPENAI_API_KEY ?? 'sk-bridge-dev'
        overrideProviderAdapter(new VercelAIAdapter({
            modelHint,
            baseURL,
            apiKey,
            log: app.log,
        }))
        app.log.info({ modelHint, baseURL }, '[command-layer] VercelAIAdapter registered')
    }
    else {
        app.log.info('[command-layer] MockProviderAdapter (default) — set AP_LLM_VIA_BRIDGE=true to use real LLM')
    }

    outboxPublisher.start({
        log: app.log,
        emit: async (event) => {
            websocketService.to(event.flowRunId).emit(WebsocketClientEvent.INTERACTIVE_FLOW_TURN_EVENT, event)
        },
        pollIntervalMs: Number(process.env.AP_OUTBOX_POLL_MS ?? 500),
    })

    lockRecoveryDaemon.start({
        log: app.log,
        pollIntervalMs: Number(process.env.AP_LOCK_RECOVERY_POLL_MS ?? 10_000),
    })

    app.addHook('onClose', async () => {
        await jobBroker(app.log).close()
        await runsMetadataQueue(app.log).close()
        await jobQueue(app.log).close()
        await pubsub.close()
        outboxPublisher.stop()
        lockRecoveryDaemon.stop()
    })
}


// This should be called after the app is booted, to ensure no plugin timeout
export const migrateQueuesAndRunConsumers = async (app: FastifyInstance): Promise<void> => {
    await queueMigration(app.log).run()
    await jobBroker(app.log).init()
}
