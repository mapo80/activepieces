import {
    FinalizeTurnRequestSchema,
    InteractiveFlowTurnEventSchema,
    InterpretTurnRequestSchema,
    InterpretTurnResponseSchema,
    RollbackTurnRequestSchema,
} from '@activepieces/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { z } from 'zod'
import { securityAccess } from '../../core/security/authorization/fastify-security'
import { commandLayerMetrics } from './metrics'
import { outboxService } from './outbox.service'
import { MockProviderAdapter, ProviderAdapter } from './provider-adapter'
import { turnInterpreter } from './turn-interpreter'

let providerAdapterSingleton: ProviderAdapter = new MockProviderAdapter()

export function overrideProviderAdapter(adapter: ProviderAdapter): void {
    providerAdapterSingleton = adapter
}

export const commandLayerController: FastifyPluginAsyncZod = async (fastify) => {
    fastify.post('/interpret-turn', InterpretTurnRoute, async (request, reply) => {
        const response = await turnInterpreter.interpret({
            request: request.body,
            provider: providerAdapterSingleton,
            identityFields: ['customerName'],
        })
        await reply.status(response.turnStatus === 'failed' ? StatusCodes.CONFLICT : StatusCodes.OK).send(response)
    })

    fastify.post('/interpret-turn/finalize', FinalizeTurnRoute, async (request, reply) => {
        const outcome = await turnInterpreter.finalize({
            turnId: request.body.turnId,
            leaseToken: request.body.leaseToken,
        })
        await reply.status(outcome.ok ? StatusCodes.OK : StatusCodes.NOT_FOUND).send(outcome)
    })

    fastify.post('/interpret-turn/rollback', RollbackTurnRoute, async (request, reply) => {
        const outcome = await turnInterpreter.rollback({
            turnId: request.body.turnId,
            leaseToken: request.body.leaseToken,
            reason: request.body.reason,
        })
        await reply.status(outcome.ok ? StatusCodes.OK : StatusCodes.NOT_FOUND).send(outcome)
    })

    fastify.get('/outbox/replay', ReplayOutboxRoute, async (request, reply) => {
        const events = await outboxService.replayPublishable({
            sessionId: request.query.sessionId,
            afterSequence: request.query.afterSequence ?? '0',
            limit: request.query.limit ?? 100,
        })
        const payloads = events.map(e => e.payload).filter(p => p !== null && typeof p === 'object')
        await reply.status(StatusCodes.OK).send({ events: payloads, count: payloads.length })
    })

    fastify.get('/metrics', MetricsRoute, async (request, reply) => {
        const fmt = (request.query as { format?: string }).format
        if (fmt === 'prometheus') {
            await reply.type('text/plain; version=0.0.4').status(StatusCodes.OK).send(commandLayerMetrics.snapshotPrometheus())
            return
        }
        await reply.status(StatusCodes.OK).send(commandLayerMetrics.snapshot())
    })

    fastify.get('/traces', TracesRoute, async (_request, reply) => {
        const { commandLayerTracing } = await import('./tracing')
        await reply.status(StatusCodes.OK).send(commandLayerTracing.summarize())
    })

    fastify.post('/admin/force-clear-stale', AdminForceClearRoute, async (request, reply) => {
        const { turnLogService } = await import('./turn-log.service')
        const { databaseConnection } = await import('../../database/database-connection')
        const ds = databaseConnection()
        const reclaimed = await turnLogService.reclaimStaleLocks({ ds, prepareStaleSeconds: request.body.prepareStaleSeconds ?? 300 })
        await reply.status(StatusCodes.OK).send({ reclaimed })
    })
}

const InterpretTurnRoute = {
    config: {
        security: securityAccess.engine(),
    },
    schema: {
        body: InterpretTurnRequestSchema,
        response: {
            [StatusCodes.OK]: InterpretTurnResponseSchema,
            [StatusCodes.CONFLICT]: InterpretTurnResponseSchema,
        },
    },
}

const FinalizeTurnRoute = {
    config: {
        security: securityAccess.engine(),
    },
    schema: {
        body: FinalizeTurnRequestSchema,
        response: {
            [StatusCodes.OK]: z.object({ ok: z.boolean() }),
            [StatusCodes.NOT_FOUND]: z.object({ ok: z.boolean() }),
        },
    },
}

const RollbackTurnRoute = {
    config: {
        security: securityAccess.engine(),
    },
    schema: {
        body: RollbackTurnRequestSchema,
        response: {
            [StatusCodes.OK]: z.object({ ok: z.boolean() }),
            [StatusCodes.NOT_FOUND]: z.object({ ok: z.boolean() }),
        },
    },
}

const ReplayOutboxRoute = {
    config: {
        security: securityAccess.engine(),
    },
    schema: {
        querystring: z.object({
            sessionId: z.string().min(1),
            afterSequence: z.string().regex(/^\d+$/).optional(),
            limit: z.coerce.number().int().min(1).max(500).optional(),
        }),
        response: {
            [StatusCodes.OK]: z.object({
                events: z.array(InteractiveFlowTurnEventSchema.partial()),
                count: z.number().int().min(0),
            }),
        },
    },
}

const MetricsRoute = {
    config: {
        security: securityAccess.engine(),
    },
    schema: {
        querystring: z.object({
            format: z.enum(['json', 'prometheus']).optional(),
        }),
        response: {
            [StatusCodes.OK]: z.union([z.record(z.string(), z.number()), z.string()]),
        },
    },
}

const TracesRoute = {
    config: {
        security: securityAccess.engine(),
    },
    schema: {
        response: {
            [StatusCodes.OK]: z.object({
                totalSpans: z.number().int().min(0),
                byName: z.record(z.string(), z.object({
                    count: z.number().int().min(0),
                    avgMs: z.number().int().min(0),
                    p95Ms: z.number().int().min(0),
                    errorRate: z.number().min(0).max(1),
                })),
            }),
        },
    },
}

const AdminForceClearRoute = {
    config: {
        security: securityAccess.engine(),
    },
    schema: {
        body: z.object({
            prepareStaleSeconds: z.number().int().min(60).max(86400).optional(),
        }),
        response: {
            [StatusCodes.OK]: z.object({ reclaimed: z.number().int().min(0) }),
        },
    },
}
