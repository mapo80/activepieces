import { ConversationCommand, FieldUpdate, InfoIntent, InteractiveFlowStateField, PendingInteraction } from '@activepieces/shared'
import { candidatePolicy } from '../candidate-policy'

type RejectedCommand = { command: ConversationCommand, reason: string }

function applyP9aCardinality({ commands }: { commands: ConversationCommand[] }): { accepted: ConversationCommand[], rejected: RejectedCommand[] } {
    const seenTypes = new Set<string>()
    const accepted: ConversationCommand[] = []
    const rejected: RejectedCommand[] = []
    const singletons = new Set(['ASK_FIELD', 'ANSWER_META', 'ANSWER_INFO', 'REQUEST_CANCEL', 'RESOLVE_PENDING', 'REPROMPT'])
    for (const cmd of commands) {
        if (singletons.has(cmd.type)) {
            if (seenTypes.has(cmd.type)) {
                rejected.push({ command: cmd, reason: `p9a-duplicate-${cmd.type.toLowerCase()}` })
                continue
            }
            seenTypes.add(cmd.type)
        }
        accepted.push(cmd)
    }
    return { accepted, rejected }
}

function checkP1Exists({ field, stateFields }: { field: string, stateFields: InteractiveFlowStateField[] }): boolean {
    return stateFields.some(f => f.name === field)
}

function checkP2Admissibility({ field, stateFields, currentNodeHint, identityFields }: {
    field: string
    stateFields: InteractiveFlowStateField[]
    currentNodeHint: PolicyCurrentNodeHint | null
    identityFields: string[]
}): { ok: true } | { ok: false, reason: string } {
    const fieldDef = stateFields.find(f => f.name === field)
    if (!fieldDef) return { ok: false, reason: 'p2-field-not-found' }
    if (fieldDef.extractable !== true) return { ok: false, reason: 'p2-not-extractable' }
    if (fieldDef.extractionScope === 'node-local') {
        if (!currentNodeHint) return { ok: false, reason: 'p2-node-local-requires-current-node' }
        if (!(currentNodeHint.stateOutputs ?? []).includes(field) && !(currentNodeHint.allowedExtraFields ?? []).includes(field) && !identityFields.includes(field)) {
            return { ok: false, reason: `p2-field-not-admissible-at-node-${currentNodeHint.nodeId}` }
        }
    }
    return { ok: true }
}

function checkP3Evidence({ update, userMessage }: { update: FieldUpdate, userMessage: string }): { ok: true } | { ok: false, reason: string } {
    const result = candidatePolicy.verifyEvidence({ evidence: update.evidence, userMessage })
    return result.ok ? { ok: true } : { ok: false, reason: `p3-${result.reason}` }
}

function checkP4Plausibility({ update, stateFields, state }: {
    update: FieldUpdate
    stateFields: InteractiveFlowStateField[]
    state: Record<string, unknown>
}): { ok: true } | { ok: false, reason: string } {
    const fieldDef = stateFields.find(f => f.name === update.field)
    if (!fieldDef) return { ok: false, reason: 'p4-field-not-found' }

    const plaus = candidatePolicy.verifyFieldPlausibility({
        field: update.field,
        value: update.value,
        rules: {
            minLength: fieldDef.minLength,
            maxLength: fieldDef.maxLength,
            pattern: fieldDef.pattern,
        },
    })
    if (!plaus.ok) return { ok: false, reason: `p4-${plaus.reason}` }

    if (fieldDef.enumFrom) {
        const catalog = state[fieldDef.enumFrom]
        if (!Array.isArray(catalog) || catalog.length === 0) {
            return { ok: false, reason: 'p4-catalog-not-ready' }
        }
        const domainResult = candidatePolicy.verifyDomain({
            field: update.field,
            value: update.value,
            catalog,
            valueField: fieldDef.enumValueField,
        })
        if (!domainResult.ok) return { ok: false, reason: `p4-${domainResult.reason}` }
    }

    return { ok: true }
}

function checkP5CitedFields({ citedFields, infoIntentId, infoIntents, stateFields, state, catalogReadiness }: {
    citedFields: string[]
    infoIntentId: string
    infoIntents: InfoIntent[]
    stateFields: InteractiveFlowStateField[]
    state: Record<string, unknown>
    catalogReadiness: Record<string, boolean>
}): { ok: true } | { ok: false, reason: string } {
    const intent = infoIntents.find(i => i.id === infoIntentId)
    if (!intent) return { ok: false, reason: 'p5-unknown-info-intent' }

    for (const field of citedFields) {
        if (!stateFields.some(f => f.name === field)) {
            return { ok: false, reason: `p5-cited-field-not-found-${field}` }
        }
        const fieldDef = stateFields.find(f => f.name === field)!
        if (fieldDef.enumFrom && catalogReadiness[fieldDef.enumFrom] === false) {
            return { ok: false, reason: 'p5-catalog-not-ready' }
        }
        if (state[field] === undefined || state[field] === null) {
            return { ok: false, reason: `p5-cited-field-empty-${field}` }
        }
    }

    for (const req of intent.requiredFields) {
        if (!citedFields.includes(req)) {
            return { ok: false, reason: `p5-missing-required-${req}` }
        }
    }
    return { ok: true }
}

function checkP6PendingCoherent({ command, pending }: { command: ConversationCommand, pending: PendingInteraction | null }): { ok: true } | { ok: false, reason: string } {
    if (command.type === 'RESOLVE_PENDING') {
        if (!pending) return { ok: false, reason: 'p6-no-pending-active' }
        if (pending.type !== command.pendingType) return { ok: false, reason: `p6-pending-type-mismatch-expected-${pending.type}-got-${command.pendingType}` }
        return { ok: true }
    }
    if (command.type === 'REQUEST_CANCEL') {
        if (pending && pending.type === 'pending_cancel') return { ok: false, reason: 'p6-cancel-already-pending' }
        return { ok: true }
    }
    return { ok: true }
}

function checkP8DispositivityScope({ update, stateFields, currentNodeHint }: {
    update: FieldUpdate
    stateFields: InteractiveFlowStateField[]
    currentNodeHint: PolicyCurrentNodeHint | null
}): { ok: true } | { ok: false, reason: string } {
    const fieldDef = stateFields.find(f => f.name === update.field)
    if (!fieldDef) return { ok: false, reason: 'p8-field-not-found' }
    if (fieldDef.extractionScope !== 'node-local') return { ok: true }
    if (!currentNodeHint || currentNodeHint.nodeType !== 'CONFIRM') {
        return { ok: false, reason: 'p8-dispositivity-outside-confirm' }
    }
    if (!(currentNodeHint.stateOutputs ?? []).includes(update.field)) {
        return { ok: false, reason: 'p8-field-not-on-current-confirm-node' }
    }
    return { ok: true }
}

function applyP9bSemanticExclusion({ commands, pending }: { commands: ConversationCommand[], pending: PendingInteraction | null }): { accepted: ConversationCommand[], rejected: RejectedCommand[] } {
    const hasRequestCancel = commands.some(c => c.type === 'REQUEST_CANCEL')
    const hasResolveCancelAccept = commands.some(c => c.type === 'RESOLVE_PENDING' && c.decision === 'accept' && c.pendingType === 'pending_cancel')
    const accepted: ConversationCommand[] = []
    const rejected: RejectedCommand[] = []
    for (const cmd of commands) {
        if (hasRequestCancel && hasResolveCancelAccept) {
            if (pending?.type === 'pending_cancel' && cmd.type === 'REQUEST_CANCEL') {
                rejected.push({ command: cmd, reason: 'p9b-exclusion-resolve-wins' })
                continue
            }
            if (pending?.type !== 'pending_cancel' && cmd.type === 'RESOLVE_PENDING' && cmd.pendingType === 'pending_cancel') {
                rejected.push({ command: cmd, reason: 'p9b-exclusion-request-wins' })
                continue
            }
        }
        accepted.push(cmd)
    }
    return { accepted, rejected }
}

function validate(input: ValidateInput): ValidateResult {
    const p9a = applyP9aCardinality({ commands: input.commands })
    const perCommand = { accepted: [] as ConversationCommand[], rejected: [...p9a.rejected] as RejectedCommand[] }
    for (const cmd of p9a.accepted) {
        const rejectReason = runPerCommandChecks({ command: cmd, input })
        if (rejectReason) {
            perCommand.rejected.push({ command: cmd, reason: rejectReason })
        }
        else {
            perCommand.accepted.push(cmd)
        }
    }
    const p9b = applyP9bSemanticExclusion({ commands: perCommand.accepted, pending: input.pendingInteraction })
    return {
        accepted: p9b.accepted,
        rejected: [...perCommand.rejected, ...p9b.rejected],
    }
}

function runPerCommandChecks({ command, input }: { command: ConversationCommand, input: ValidateInput }): string | null {
    switch (command.type) {
        case 'SET_FIELDS':
            for (const update of command.updates) {
                if (!checkP1Exists({ field: update.field, stateFields: input.stateFields })) return 'p1-field-not-found'
                const p2 = checkP2Admissibility({ field: update.field, stateFields: input.stateFields, currentNodeHint: input.currentNodeHint, identityFields: input.identityFields })
                if (!p2.ok) return p2.reason
                const p3 = checkP3Evidence({ update, userMessage: input.userMessage })
                if (!p3.ok) return p3.reason
                const p4 = checkP4Plausibility({ update, stateFields: input.stateFields, state: input.state })
                if (!p4.ok) return p4.reason
                const p8 = checkP8DispositivityScope({ update, stateFields: input.stateFields, currentNodeHint: input.currentNodeHint })
                if (!p8.ok) return p8.reason
            }
            return null
        case 'ASK_FIELD':
            if (!checkP1Exists({ field: command.field, stateFields: input.stateFields })) return 'p1-field-not-found'
            return null
        case 'ANSWER_INFO':
            for (const cited of command.citedFields) {
                if (!checkP1Exists({ field: cited, stateFields: input.stateFields })) return `p1-cited-field-not-found-${cited}`
            }
            const p5 = checkP5CitedFields({
                citedFields: command.citedFields,
                infoIntentId: command.infoIntent,
                infoIntents: input.infoIntents,
                stateFields: input.stateFields,
                state: input.state,
                catalogReadiness: input.catalogReadiness,
            })
            if (!p5.ok) return p5.reason
            return null
        case 'RESOLVE_PENDING':
        case 'REQUEST_CANCEL': {
            const p6 = checkP6PendingCoherent({ command, pending: input.pendingInteraction })
            if (!p6.ok) return p6.reason
            return null
        }
        case 'ANSWER_META':
        case 'REPROMPT':
            return null
        default:
            return 'unknown-command'
    }
}

export const policyEngine = {
    validate,
}

export type PolicyCurrentNodeHint = {
    nodeId: string
    nodeType: 'USER_INPUT' | 'CONFIRM'
    stateOutputs?: string[]
    allowedExtraFields?: string[]
}

export type ValidateInput = {
    commands: ConversationCommand[]
    stateFields: InteractiveFlowStateField[]
    state: Record<string, unknown>
    currentNodeHint: PolicyCurrentNodeHint | null
    pendingInteraction: PendingInteraction | null
    userMessage: string
    identityFields: string[]
    infoIntents: InfoIntent[]
    catalogReadiness: Record<string, boolean>
}

export type ValidateResult = {
    accepted: ConversationCommand[]
    rejected: RejectedCommand[]
}
