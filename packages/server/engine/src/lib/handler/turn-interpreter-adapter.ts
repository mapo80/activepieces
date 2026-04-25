import { randomUUID } from 'node:crypto'
import { InfoIntent, InteractiveFlowNode, InteractiveFlowStateField, InterpretTurnRequest, InterpretTurnResponse, PendingInteraction } from '@activepieces/shared'
import { EngineConstants } from './context/engine-constants'
import { ExtractResult, fieldExtractor, PolicyDecision } from './field-extractor'
import { turnInterpreterClient } from './turn-interpreter-client'
import { emptyTurnResult, TurnResult } from './turn-result'

export type TurnInterpreterAdapter = {
    interpret(args: AdapterInterpretArgs): Promise<TurnResult>
}

export type AdapterInterpretArgs = {
    constants: EngineConstants
    message: string
    systemPrompt?: string
    locale?: string
    flowLabel?: string
    state: Record<string, unknown>
    history: Array<{ role: 'user' | 'assistant', text: string }>
    stateFields: InteractiveFlowStateField[]
    nodes: InteractiveFlowNode[]
    currentNode: CurrentNode | null
    pendingInteraction: PendingInteraction | null
    identityFields: string[]
    infoIntents: InfoIntent[]
    sessionId: string
    sessionRevision: number
    flowVersionId: string
}

export type CurrentNode = {
    nodeId: string
    nodeType: 'USER_INPUT' | 'CONFIRM' | 'TOOL' | 'BRANCH'
    displayName?: string
    stateOutputs?: string[]
    allowedExtraFields?: string[]
    prompt?: string
    displayField?: string
    nextMissingField?: string
}

export const legacyFieldExtractorAdapter: TurnInterpreterAdapter = {
    async interpret(args: AdapterInterpretArgs): Promise<TurnResult> {
        const legacyResult = await fieldExtractor.extractWithPolicy({
            constants: args.constants,
            config: { aiProviderId: '', model: '' },
            message: args.message,
            stateFields: args.stateFields,
            currentState: args.state,
            systemPrompt: args.systemPrompt,
            locale: args.locale,
            currentNode: args.currentNode ?? undefined,
            identityFields: args.identityFields,
            pendingInteraction: args.pendingInteraction,
            flowLabel: args.flowLabel,
        })
        return adaptLegacyToTurnResult(legacyResult)
    },
}

export const commandLayerClientAdapter: TurnInterpreterAdapter = {
    async interpret(args: AdapterInterpretArgs): Promise<TurnResult> {
        const catalogReadiness = turnInterpreterClient.buildCatalogReadiness({
            state: args.state,
            stateFields: args.stateFields,
        })
        const request: InterpretTurnRequest = {
            turnId: `turn-${randomUUID()}`,
            idempotencyKey: `idem-${randomUUID()}`,
            sessionId: args.sessionId,
            sessionRevision: args.sessionRevision,
            flowRunId: args.constants.flowRunId,
            flowVersionId: args.flowVersionId,
            message: args.message,
            state: args.state,
            history: args.history,
            pendingInteraction: args.pendingInteraction,
            stateFields: args.stateFields,
            nodes: args.nodes,
            currentNodeHint: args.currentNode && (args.currentNode.nodeType === 'USER_INPUT' || args.currentNode.nodeType === 'CONFIRM')
                ? {
                    nodeId: args.currentNode.nodeId,
                    nodeType: args.currentNode.nodeType,
                    displayName: args.currentNode.displayName,
                    stateOutputs: args.currentNode.stateOutputs,
                    allowedExtraFields: args.currentNode.allowedExtraFields,
                }
                : null,
            infoIntents: args.infoIntents,
            systemPrompt: args.systemPrompt,
            locale: args.locale,
            catalogReadiness,
        }
        const response = await turnInterpreterClient.interpret({ constants: args.constants, request })
        if (!response) return emptyTurnResult
        return adaptCommandLayerResponseToTurnResult(response)
    },
}

function adaptLegacyToTurnResult(legacy: ExtractResult): TurnResult {
    return {
        extractedFields: legacy.extractedFields,
        turnAffirmed: legacy.turnAffirmed,
        policyDecisions: legacy.policyDecisions,
        metaAnswer: legacy.metaAnswer,
        clarifyReason: legacy.clarifyReason,
        topicChange: { topicChanged: false, clearedKeys: [] },
        pendingOverwriteSignal: pendingOverwriteFromLegacy(legacy.policyDecisions),
        rejectionHint: legacy.policyDecisions.find((d: PolicyDecision) => d.action === 'reject')?.reason ?? null,
    }
}

function pendingOverwriteFromLegacy(decisions: PolicyDecision[]): unknown {
    for (const d of decisions) {
        if (d.action === 'confirm' && d.pendingOverwrite) {
            return { field: d.pendingOverwrite.field, oldValue: d.pendingOverwrite.oldValue, newValue: d.pendingOverwrite.newValue }
        }
    }
    return null
}

function adaptCommandLayerResponseToTurnResult(response: InterpretTurnResponse): TurnResult {
    const extractedFields = { ...response.stateDiff }
    return {
        extractedFields,
        turnAffirmed: response.acceptedCommands.length > 0,
        policyDecisions: response.lastPolicyDecisions,
        topicChange: response.topicChange,
        pendingOverwriteSignal: response.pendingOverwriteSignal,
        rejectionHint: response.rejectionHint,
        turnEvents: response.turnEvents,
        acceptedCommands: response.acceptedCommands,
        rejectedCommands: response.rejectedCommands,
        messageOut: response.messageOut,
        pendingInteractionNext: response.pendingInteractionNext,
        finalizeContract: response.finalizeContract,
        lastPolicyDecisions: response.lastPolicyDecisions,
        sessionSequenceRange: response.sessionSequenceRange,
    }
}

export function selectAdapter({ useCommandLayer }: { useCommandLayer: boolean | undefined }): TurnInterpreterAdapter {
    return useCommandLayer === true ? commandLayerClientAdapter : legacyFieldExtractorAdapter
}

export async function interpretTurn(args: AdapterInterpretArgs & { useCommandLayer: boolean | undefined }): Promise<TurnResult> {
    const adapter = selectAdapter({ useCommandLayer: args.useCommandLayer })
    return adapter.interpret(args)
}
