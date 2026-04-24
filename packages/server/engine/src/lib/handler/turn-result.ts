import { ConversationCommand, InteractiveFlowTurnEvent, InterpretTurnMessageOut, InterpretTurnPolicyDecision, PendingInteraction } from '@activepieces/shared'

export type TurnResult = {
    extractedFields: Record<string, unknown>
    turnAffirmed: boolean
    policyDecisions: unknown[]
    metaAnswer?: string
    clarifyReason?: unknown
    topicChange: {
        topicChanged: boolean
        clearedKeys: string[]
    }
    pendingOverwriteSignal: unknown
    rejectionHint: string | null
    turnEvents?: InteractiveFlowTurnEvent[]
    acceptedCommands?: ConversationCommand[]
    rejectedCommands?: Array<{ command: ConversationCommand, reason: string }>
    messageOut?: InterpretTurnMessageOut
    pendingInteractionNext?: PendingInteraction | null
    finalizeContract?: { turnId: string, leaseToken: string }
    lastPolicyDecisions?: InterpretTurnPolicyDecision[]
    sessionSequenceRange?: { from: string, to: string }
}

export const emptyTurnResult: TurnResult = {
    extractedFields: {},
    turnAffirmed: false,
    policyDecisions: [],
    topicChange: { topicChanged: false, clearedKeys: [] },
    pendingOverwriteSignal: null,
    rejectionHint: null,
}
