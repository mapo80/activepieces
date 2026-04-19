import {
    AIProviderName,
    assertNotNullOrUndefined,
    EnginePrincipal,
} from '@activepieces/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { z } from 'zod'
import { securityAccess } from '../core/security/authorization/fastify-security'
import { aiProviderService } from './ai-provider-service'

export const aiProviderWorkerController: FastifyPluginAsyncZod = async (app) => {
    app.get('/:provider/resolve', ResolveRoute, async (request) => {
        const enginePrincipal = request.principal as EnginePrincipal
        assertNotNullOrUndefined(enginePrincipal.platform?.id, 'platformId')

        const { auth, config } = await aiProviderService(request.log).getConfigOrThrow({
            platformId: enginePrincipal.platform.id,
            provider: request.params.provider,
        })

        return {
            provider: request.params.provider,
            auth,
            config,
        }
    })
}

const ResolveRoute = {
    config: {
        security: securityAccess.engine(),
    },
    schema: {
        params: z.object({
            provider: z.nativeEnum(AIProviderName),
        }),
        response: {
            [StatusCodes.OK]: z.object({
                provider: z.nativeEnum(AIProviderName),
                auth: z.unknown(),
                config: z.unknown(),
            }),
        },
    },
}
