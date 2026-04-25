import {
    DeleteStoreEntryRequest,
    GetStoreEntryRequest,
    PutStoreEntryRequest,
    STORE_KEY_MAX_LENGTH,
    STORE_VALUE_MAX_SIZE,
} from '@activepieces/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import sizeof from 'object-sizeof'
import { z } from 'zod'
import { securityAccess } from '../core/security/authorization/fastify-security'
import { storeEntryService } from './store-entry.service'

export const storeEntryController: FastifyPluginAsyncZod = async (fastify) => {
    fastify.post( '/', CreateRequest, async (request, reply) => {
        const sizeOfValue = sizeof(request.body.value)
        if (sizeOfValue > STORE_VALUE_MAX_SIZE) {
            await reply.status(StatusCodes.REQUEST_TOO_LONG).send({})
            return
        }
        const response = await storeEntryService.upsert({
            projectId: request.principal.projectId,
            request: request.body,
        })
        await reply.status(StatusCodes.OK).send(response)
    },
    )

    fastify.get('/', GetRequest, async (request, reply) => {
        const value = await storeEntryService.getOne({
            projectId: request.principal.projectId,
            key: request.query.key,
        })

        if (!value) {
            return reply.code(StatusCodes.NOT_FOUND).send('Value not found!')
        }

        return value
    },
    )

    fastify.delete('/', DeleteStoreRequest, async (request) => {
        return storeEntryService.delete({
            projectId: request.principal.projectId,
            key: request.query.key,
        })
    },
    )

    fastify.get('/with-version', GetWithVersionRequest, async (request, reply) => {
        const result = await storeEntryService.getOneWithVersion({
            projectId: request.principal.projectId,
            key: request.query.key,
        })
        if (!result) {
            await reply.status(StatusCodes.NOT_FOUND).send({ message: 'not-found' })
            return
        }
        await reply.status(StatusCodes.OK).send(result)
    },
    )

    fastify.post('/put-with-version', PutWithVersionRequest, async (request, reply) => {
        const sizeOfValue = sizeof(request.body.value)
        if (sizeOfValue > STORE_VALUE_MAX_SIZE) {
            await reply.status(StatusCodes.REQUEST_TOO_LONG).send({})
            return
        }
        const result = await storeEntryService.upsertWithExpectedVersion({
            projectId: request.principal.projectId,
            key: request.body.key,
            value: request.body.value,
            expectedVersion: request.body.expectedVersion,
        })
        if (result.status === 'ok') {
            await reply.status(StatusCodes.OK).send({ version: result.newVersion })
            return
        }
        await reply.status(StatusCodes.PRECONDITION_FAILED).send({
            message: 'precondition-failed',
            currentVersion: result.currentVersion,
        })
    },
    )
}

const CreateRequest =  {
    config: {
        security: securityAccess.engine(),
    },
    schema: {
        body: PutStoreEntryRequest,
    },
}

const GetRequest = {
    config: {
        security: securityAccess.engine(),
    },
    schema: {
        querystring: GetStoreEntryRequest,
    },
}


const DeleteStoreRequest = {
    config: {
        security: securityAccess.engine(),
    },
    schema: {
        querystring: DeleteStoreEntryRequest,
    },
}

const PutWithVersionBodySchema = z.object({
    key: z.string().max(STORE_KEY_MAX_LENGTH),
    value: z.any().optional(),
    expectedVersion: z.number().int().min(0),
})

const PutWithVersionRequest = {
    config: {
        security: securityAccess.engine(),
    },
    schema: {
        body: PutWithVersionBodySchema,
    },
}

const GetWithVersionRequest = {
    config: {
        security: securityAccess.engine(),
    },
    schema: {
        querystring: z.object({ key: z.string() }),
    },
}