import { hostname } from 'node:os'
import {
    ConversationCommand,
    InterpretTurnMessageOut,
    InterpretTurnPolicyDecision,
    InterpretTurnRequest,
    InterpretTurnResponse,
} from '@activepieces/shared'
import { commandDispatcher } from './command-dispatcher'
import { commandLayerMetrics } from './metrics'
import { outboxService } from './outbox.service'
import { PolicyCurrentNodeHint, policyEngine } from './policy-engine'
import { preResolvers } from './pre-resolvers'
import { promptBuilder } from './prompt-builder'
import { ProviderAdapter } from './provider-adapter'
import { turnLogService } from './turn-log.service'

const DEFAULT_LEASE_TTL_SECONDS = 30

function workerIdFromEnv(): string {
    return `${hostname()}-${process.pid}`
}

async function interpret({ request, provider, identityFields, now }: InterpretInput): Promise<InterpretTurnResponse> {
    const nowDate = now ?? new Date()
    const workerId = workerIdFromEnv()

    const leaseResult = await turnLogService.acquireLease({
        turnId: request.turnId,
        sessionId: request.sessionId,
        flowRunId: request.flowRunId,
        workerId,
        ttlSeconds: DEFAULT_LEASE_TTL_SECONDS,
    })
    commandLayerMetrics.recordLeaseOutcome({ outcome: leaseResult.outcome })

    if (leaseResult.outcome === 'replay') {
        const existing = await turnLogService.findByTurnId({ turnId: request.turnId })
        if (existing && existing.result) {
            const priorResult = existing.result as Partial<InterpretTurnResponse>
            return buildReplayResponse({ request, priorResult })
        }
    }
    if (leaseResult.outcome === 'locked-by-other' || leaseResult.outcome === 'failed-previous' || leaseResult.outcome === 'unknown-error') {
        return buildFailedResponse({ request, reason: leaseResult.outcome })
    }
    if (leaseResult.outcome !== 'acquired' || !leaseResult.leaseToken) {
        return buildFailedResponse({ request, reason: 'lease-unknown' })
    }

    const leaseToken = leaseResult.leaseToken

    try {
        const preResolveResult = preResolvers.resolve({
            message: request.message,
            pending: request.pendingInteraction,
            now: nowDate,
        })

        let proposedCommands: ConversationCommand[]
        if (preResolveResult.ok) {
            proposedCommands = preResolveResult.commands
        }
        else {
            const systemPrompt = promptBuilder.build({
                input: {
                    flowLabel: undefined,
                    state: request.state,
                    stateFields: request.stateFields,
                    currentNodeHint: request.currentNodeHint ?? null,
                    pendingInteraction: request.pendingInteraction,
                    infoIntents: request.infoIntents,
                    catalogReadiness: request.catalogReadiness,
                    locale: request.locale,
                    systemPromptAddendum: request.systemPrompt,
                },
            })
            const allowedFields = promptBuilder.buildAllowedFields({ stateFields: request.stateFields, catalogReadiness: request.catalogReadiness })
            const providerResult = await provider.proposeCommands({
                systemPrompt,
                userMessage: request.message,
                conversationHistory: request.history,
                allowedFields,
                allowedInfoIntents: request.infoIntents.map(i => i.id),
            })
            proposedCommands = providerResult.commands
        }

        const currentNodeHint: PolicyCurrentNodeHint | null = request.currentNodeHint
            ? {
                nodeId: request.currentNodeHint.nodeId,
                nodeType: request.currentNodeHint.nodeType,
                stateOutputs: request.currentNodeHint.stateOutputs,
                allowedExtraFields: request.currentNodeHint.allowedExtraFields,
            }
            : null

        const validationResult = policyEngine.validate({
            commands: proposedCommands,
            stateFields: request.stateFields,
            state: request.state,
            currentNodeHint,
            pendingInteraction: request.pendingInteraction,
            userMessage: request.message,
            identityFields,
            infoIntents: request.infoIntents,
            catalogReadiness: request.catalogReadiness,
        })

        const writeIntents = commandDispatcher.collectWriteIntents({ accepted: validationResult.accepted, pending: request.pendingInteraction })
        const conflictResolution = commandDispatcher.resolveConflicts({ writes: writeIntents })
        const stateDiff = commandDispatcher.computeStateDiff({ applied: conflictResolution.applied })
        const pendingDiff = commandDispatcher.computePendingDiff({
            accepted: validationResult.accepted,
            currentPending: request.pendingInteraction,
            newRequestCancelReason: (validationResult.accepted.find(c => c.type === 'REQUEST_CANCEL') as { reason?: string } | undefined)?.reason ?? null,
            now: nowDate,
        })
        const messageOut = commandDispatcher.buildMessageOut({
            accepted: validationResult.accepted,
            infoIntents: request.infoIntents,
            state: { ...request.state, ...stateDiff },
            locale: request.locale,
        })
        const policyDecisions = commandDispatcher.buildPolicyDecisions({
            accepted: validationResult.accepted,
            rejected: validationResult.rejected,
        })

        const insertedEvents = await outboxService.insertPending({
            turnId: request.turnId,
            sessionId: request.sessionId,
            flowRunId: request.flowRunId,
            events: [],
        })
        const sessionSequenceStart = (insertedEvents.length > 0 ? insertedEvents[0].sessionSequence : '1')

        const turnEvents = commandDispatcher.buildTurnEvents({
            accepted: validationResult.accepted,
            rejected: validationResult.rejected,
            state: request.state,
            infoIntents: request.infoIntents,
            turnContext: {
                turnId: request.turnId,
                sessionId: request.sessionId,
                flowRunId: request.flowRunId,
                sessionSequenceStart,
            },
        })

        const turnEventsForOutbox = turnEvents.map(evt => ({ eventType: evt.kind, payload: evt as unknown as Record<string, unknown> }))
        const persistedEvents = await outboxService.insertPending({
            turnId: request.turnId,
            sessionId: request.sessionId,
            flowRunId: request.flowRunId,
            events: turnEventsForOutbox,
        })

        const responseResult: InterpretTurnResponse = {
            turnStatus: 'prepared',
            messageOut,
            stateDiff,
            pendingInteractionNext: pendingDiff.next,
            topicChange: { topicChanged: false, clearedKeys: [] },
            pendingOverwriteSignal: null,
            rejectionHint: validationResult.rejected.length > 0 ? buildRejectionHintSummary({ rejected: validationResult.rejected }) : null,
            lastPolicyDecisions: policyDecisions,
            turnEvents: persistedEvents.map((e, i) => ({
                outboxEventId: e.outboxEventId,
                turnId: e.turnId,
                sessionId: e.sessionId,
                flowRunId: e.flowRunId,
                sessionSequence: e.sessionSequence,
                kind: turnEvents[i]?.kind ?? 'TURN_COMMITTED',
                payload: (turnEvents[i]?.payload ?? {}) as Record<string, unknown>,
                timestamp: turnEvents[i]?.timestamp ?? new Date().toISOString(),
            })),
            acceptedCommands: validationResult.accepted,
            rejectedCommands: validationResult.rejected,
            sessionSequenceRange: persistedEvents.length > 0
                ? { from: persistedEvents[0].sessionSequence, to: persistedEvents[persistedEvents.length - 1].sessionSequence }
                : undefined,
            finalizeContract: { turnId: request.turnId, leaseToken },
        }

        await turnLogService.prepare({
            turnId: request.turnId,
            leaseToken,
            acceptedCommands: validationResult.accepted,
            rejectedCommands: validationResult.rejected,
            result: responseResult,
        })

        return responseResult
    }
    catch (err) {
        await turnLogService.fail({ turnId: request.turnId, leaseToken, reason: String(err).slice(0, 500) })
        throw err
    }
}

async function finalize({ turnId, leaseToken }: { turnId: string, leaseToken: string }): Promise<{ ok: boolean }> {
    const finalized = await turnLogService.finalize({ turnId, leaseToken })
    if (!finalized) return { ok: false }
    await outboxService.markPublishable({ turnId })
    return { ok: true }
}

async function rollback({ turnId, leaseToken, reason }: { turnId: string, leaseToken: string, reason?: string }): Promise<{ ok: boolean }> {
    const compensated = await turnLogService.compensate({ turnId, leaseToken, reason })
    if (!compensated) return { ok: false }
    await outboxService.markVoid({ turnId })
    return { ok: true }
}

function buildRejectionHintSummary({ rejected }: { rejected: Array<{ command: ConversationCommand, reason: string }> }): string {
    return rejected.map(r => `${r.command.type}:${r.reason}`).join(';')
}

function buildReplayResponse({ request, priorResult }: { request: InterpretTurnRequest, priorResult: Partial<InterpretTurnResponse> }): InterpretTurnResponse {
    return {
        turnStatus: 'replayed',
        messageOut: priorResult.messageOut ?? { preDagAck: 'Replay', kind: 'ack-only' },
        stateDiff: priorResult.stateDiff ?? {},
        pendingInteractionNext: priorResult.pendingInteractionNext ?? null,
        topicChange: priorResult.topicChange ?? { topicChanged: false, clearedKeys: [] },
        pendingOverwriteSignal: priorResult.pendingOverwriteSignal ?? null,
        rejectionHint: priorResult.rejectionHint ?? null,
        lastPolicyDecisions: priorResult.lastPolicyDecisions ?? [],
        turnEvents: priorResult.turnEvents ?? [],
        acceptedCommands: priorResult.acceptedCommands ?? [],
        rejectedCommands: priorResult.rejectedCommands ?? [],
        finalizeContract: priorResult.finalizeContract ?? { turnId: request.turnId, leaseToken: '00000000-0000-0000-0000-000000000000' },
    }
}

function buildFailedResponse({ request, reason }: { request: InterpretTurnRequest, reason: string }): InterpretTurnResponse {
    return {
        turnStatus: 'failed',
        messageOut: { preDagAck: `Impossibile elaborare il turno: ${reason}`, kind: 'reprompt' },
        stateDiff: {},
        pendingInteractionNext: null,
        topicChange: { topicChanged: false, clearedKeys: [] },
        pendingOverwriteSignal: null,
        rejectionHint: reason,
        lastPolicyDecisions: [],
        turnEvents: [],
        acceptedCommands: [],
        rejectedCommands: [],
        finalizeContract: { turnId: request.turnId, leaseToken: '00000000-0000-0000-0000-000000000000' },
    }
}

export const turnInterpreter = {
    interpret,
    finalize,
    rollback,
}

export type InterpretInput = {
    request: InterpretTurnRequest
    provider: ProviderAdapter
    identityFields: string[]
    now?: Date
}

export type { InterpretTurnPolicyDecision, InterpretTurnMessageOut }
