import {
    FinalizeTurnRequestSchema,
    InterpretTurnRequestSchema,
    InterpretTurnResponseSchema,
    RollbackTurnRequestSchema,
} from '@activepieces/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { z } from 'zod'
import { securityAccess } from '../../core/security/authorization/fastify-security'
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
