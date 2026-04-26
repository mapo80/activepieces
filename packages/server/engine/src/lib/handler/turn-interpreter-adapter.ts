import { randomUUID } from 'node:crypto'
import { InfoIntent, InteractiveFlowNode, InteractiveFlowStateField, InterpretTurnRequest, InterpretTurnResponse, PendingInteraction } from '@activepieces/shared'
import { EngineConstants } from './context/engine-constants'
import { turnInterpreterClient } from './turn-interpreter-client'
import { emptyTurnResult, TurnResult } from './turn-result'

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

export async function interpretTurn(args: AdapterInterpretArgs): Promise<TurnResult> {
    return commandLayerClientAdapter.interpret(args)
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
