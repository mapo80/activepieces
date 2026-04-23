import {
    CopilotEvent,
    isNil,
    PrincipalType,
} from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { securityAccess } from '../../core/security/authorization/fastify-security'
import { platformMustHaveFeatureEnabled } from '../../ee/authentication/ee-authorization'
import { flowService } from '../../flows/flow/flow.service'
import { flowVersionService } from '../../flows/flow-version/flow-version.service'
import { ndjsonReply } from '../../helper/ndjson-reply'
import { copilotService } from './copilot-service'
import { copilotScopeDetector } from './scope-detector'
import { registerEmptyOrNewScope } from './scopes/empty-or-new'
import { registerInteractiveFlowScope } from './scopes/interactive-flow'
import { copilotSessionStore } from './session-store'
import { copilotUndoHandler } from './undo-handler'

const COPILOT_SECURITY = {
    security: securityAccess.publicPlatform([PrincipalType.USER]),
}

let scopesRegistered = false
function ensureScopesRegistered(log: FastifyBaseLogger): void {
    if (scopesRegistered) return
    registerInteractiveFlowScope(log)
    registerEmptyOrNewScope(log)
    scopesRegistered = true
}

const CreateSessionBody = z.object({
    flowId: z.string(),
    projectId: z.string(),
    selectedStepName: z.string().optional(),
})

const MessageBody = z.object({
    message: z.string().min(1),
})

const UndoBody = z.object({
    mode: z.enum(['copilot-only', 'reset-to-snapshot']),
})

export const copilotController: FastifyPluginAsyncZod = async (app) => {
    app.addHook(
        'preHandler',
        platformMustHaveFeatureEnabled((platform) => platform.plan.copilotEnabled),
    )

    app.post('/sessions', { schema: { body: CreateSessionBody }, config: COPILOT_SECURITY }, async (req) => {
        ensureScopesRegistered(req.log)
        const body = req.body as z.infer<typeof CreateSessionBody>
        const principal = req.principal
        if (principal.type !== PrincipalType.USER) {
            throw new Error('unauthorized')
        }
        const flow = await flowService(req.log).getOnePopulatedOrThrow({
            id: body.flowId,
            projectId: body.projectId,
        })
        const flowVersion = await flowVersionService(req.log).getOneOrThrow(flow.version.id)
        const scope = copilotScopeDetector.detectScope({
            flowVersion,
            selectedStepName: body.selectedStepName,
        })
        if (isNil(scope)) throw new Error('scope-not-supported')
        const session = copilotSessionStore.create({
            userId: principal.id,
            projectId: body.projectId,
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
    })

    app.post('/sessions/:id/message', { schema: { body: MessageBody }, config: COPILOT_SECURITY }, async (req, reply) => {
        ensureScopesRegistered(req.log)
        const params = req.params as { id: string }
        const body = req.body as z.infer<typeof MessageBody>
        const session = copilotSessionStore.get(params.id)
        if (isNil(session)) {
            void reply.status(404).send({ error: 'session-not-found' })
            return
        }
        if (req.principal.type !== PrincipalType.USER || req.principal.id !== session.userId) {
            void reply.status(403).send({ error: 'forbidden' })
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
    })

    app.post('/sessions/:id/undo', { schema: { body: UndoBody }, config: COPILOT_SECURITY }, async (req, reply) => {
        const params = req.params as { id: string }
        const body = req.body as z.infer<typeof UndoBody>
        const session = copilotSessionStore.get(params.id)
        if (isNil(session)) {
            void reply.status(404).send({ error: 'session-not-found' })
            return
        }
        if (req.principal.type !== PrincipalType.USER || req.principal.id !== session.userId) {
            void reply.status(403).send({ error: 'forbidden' })
            return
        }
        const newVersion = await copilotUndoHandler.undo({
            session,
            mode: body.mode,
            log: req.log,
        })
        return { flowVersion: newVersion }
    })

    app.delete('/sessions/:id', { config: COPILOT_SECURITY }, async (req, reply) => {
        const params = req.params as { id: string }
        const session = copilotSessionStore.get(params.id)
        if (isNil(session)) {
            void reply.status(404).send({ error: 'session-not-found' })
            return
        }
        if (req.principal.type !== PrincipalType.USER || req.principal.id !== session.userId) {
            void reply.status(403).send({ error: 'forbidden' })
            return
        }
        copilotSessionStore.delete(params.id)
        return { deleted: true }
    })
}
