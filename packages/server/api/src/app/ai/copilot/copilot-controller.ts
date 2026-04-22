import { FastifyPluginAsyncTypebox, Type } from '@fastify/type-provider-typebox'
import { StatusCodes } from 'http-status-codes'
import { FastifyBaseLogger } from 'fastify'
import {
    CopilotEvent,
    CopilotMessageRequestSchema,
    CopilotSessionCreateRequestSchema,
    CopilotUndoRequestSchema,
    isNil,
    PrincipalType,
} from '@activepieces/shared'
import { copilotSessionStore } from './session-store'
import { copilotScopeDetector } from './scope-detector'
import { copilotService } from './copilot-service'
import { copilotUndoHandler } from './undo-handler'
import { registerInteractiveFlowScope } from './scopes/interactive-flow'
import { registerEmptyOrNewScope } from './scopes/empty-or-new'
import { flowVersionService } from '../../flows/flow-version/flow-version.service'
import { flowService } from '../../flows/flow/flow.service'
import { ndjsonReply } from '../../helper/ndjson-reply'
import { platformMustHaveFeatureEnabled } from '../../ee/authentication/ee-authorization'

let scopesRegistered = false
function ensureScopesRegistered(log: FastifyBaseLogger): void {
    if (scopesRegistered) return
    registerInteractiveFlowScope(log)
    registerEmptyOrNewScope(log)
    scopesRegistered = true
}

export const copilotController: FastifyPluginAsyncTypebox = async (app) => {
    app.addHook(
        'preHandler',
        platformMustHaveFeatureEnabled((platform) => platform.plan.copilotEnabled),
    )

    app.post(
        '/sessions',
        {
            schema: {
                body: Type.Object({
                    flowId: Type.String(),
                    selectedStepName: Type.Optional(Type.String()),
                }),
                response: {
                    [StatusCodes.OK]: Type.Object({
                        sessionId: Type.String(),
                        scope: Type.String(),
                        flowVersionId: Type.String(),
                    }),
                },
            },
        },
        async (req) => {
            ensureScopesRegistered(req.log)
            const body = CopilotSessionCreateRequestSchema.parse(req.body)
            const principal = req.principal
            if (principal.type !== PrincipalType.USER) throw new Error('unauthorized')
            const flow = await flowService(req.log).getOnePopulatedOrThrow({ id: body.flowId, projectId: principal.projectId })
            const flowVersion = await flowVersionService(req.log).getOneOrThrow(flow.version.id)
            const scope = copilotScopeDetector.detectScope({ flowVersion, selectedStepName: body.selectedStepName })
            if (isNil(scope)) throw new Error('scope-not-supported')
            const session = copilotSessionStore.create({
                userId: principal.id,
                projectId: principal.projectId,
                platformId: principal.platform.id,
                flowId: body.flowId,
                flowVersion,
                scope,
            })
            return {
                sessionId: session.id,
                scope: session.scope,
                flowVersionId: session.flowVersionId,
            }
        },
    )

    app.post(
        '/sessions/:id/message',
        {
            schema: {
                params: Type.Object({ id: Type.String() }),
                body: Type.Object({ message: Type.String() }),
            },
        },
        async (req, reply) => {
            ensureScopesRegistered(req.log)
            const params = req.params as { id: string }
            const body = CopilotMessageRequestSchema.parse(req.body)
            const session = copilotSessionStore.get(params.id)
            if (isNil(session)) {
                reply.status(404).send({ error: 'session-not-found' })
                return
            }
            if (req.principal.type !== PrincipalType.USER || req.principal.id !== session.userId) {
                reply.status(403).send({ error: 'forbidden' })
                return
            }
            const abortController = new AbortController()
            req.raw.on('close', () => abortController.abort())
            const timeout = setTimeout(() => abortController.abort(), copilotService.TIMEOUT_MS)
            const events = copilotService.runCopilotLoop({
                session,
                userMessage: body.message,
                log: req.log,
                abortSignal: abortController.signal,
            })
            await ndjsonReply.streamNdjson<CopilotEvent>({
                reply,
                events,
                onError: (err) => ({ type: 'error', message: err.message }),
            })
            clearTimeout(timeout)
        },
    )

    app.post(
        '/sessions/:id/undo',
        {
            schema: {
                params: Type.Object({ id: Type.String() }),
                body: Type.Object({
                    mode: Type.Union([Type.Literal('copilot-only'), Type.Literal('reset-to-snapshot')]),
                }),
            },
        },
        async (req, reply) => {
            const params = req.params as { id: string }
            const body = CopilotUndoRequestSchema.parse(req.body)
            const session = copilotSessionStore.get(params.id)
            if (isNil(session)) {
                reply.status(404).send({ error: 'session-not-found' })
                return
            }
            if (req.principal.type !== PrincipalType.USER || req.principal.id !== session.userId) {
                reply.status(403).send({ error: 'forbidden' })
                return
            }
            const newVersion = await copilotUndoHandler.undo({ session, mode: body.mode, log: req.log })
            return { flowVersion: newVersion }
        },
    )

    app.delete(
        '/sessions/:id',
        {
            schema: {
                params: Type.Object({ id: Type.String() }),
            },
        },
        async (req, reply) => {
            const params = req.params as { id: string }
            const session = copilotSessionStore.get(params.id)
            if (isNil(session)) {
                reply.status(404).send({ error: 'session-not-found' })
                return
            }
            if (req.principal.type !== PrincipalType.USER || req.principal.id !== session.userId) {
                reply.status(403).send({ error: 'forbidden' })
                return
            }
            copilotSessionStore.delete(params.id)
            return { deleted: true }
        },
    )
}
