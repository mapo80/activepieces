import { randomUUID } from 'node:crypto'
import {
    ConversationCommand,
    FieldUpdate,
    InfoIntent,
    InteractiveFlowTurnEvent,
    InterpretTurnMessageKind,
    InterpretTurnMessageOut,
    InterpretTurnPolicyDecision,
    PendingInteraction,
} from '@activepieces/shared'
import { infoRenderer } from './info-renderer'

type WriteIntent = {
    field: string
    source: 'SET_FIELDS' | 'RESOLVE_PENDING'
    value: unknown
    evidence?: string
    commandIndex: number
}

function collectWriteIntents({ accepted, pending }: { accepted: ConversationCommand[], pending: PendingInteraction | null }): WriteIntent[] {
    const writes: WriteIntent[] = []
    accepted.forEach((cmd, i) => {
        if (cmd.type === 'SET_FIELDS') {
            for (const update of cmd.updates) {
                writes.push({
                    field: update.field,
                    source: 'SET_FIELDS',
                    value: update.value,
                    evidence: update.evidence,
                    commandIndex: i,
                })
            }
        }
        else if (cmd.type === 'RESOLVE_PENDING' && cmd.decision === 'accept' && pending) {
            if (pending.type === 'confirm_binary') {
                writes.push({ field: pending.field, source: 'RESOLVE_PENDING', value: pending.target, commandIndex: i })
            }
            else if (pending.type === 'pending_overwrite') {
                writes.push({ field: pending.field, source: 'RESOLVE_PENDING', value: pending.newValue, commandIndex: i })
            }
            else if (pending.type === 'pick_from_list') {
                writes.push({ field: pending.field, source: 'RESOLVE_PENDING', value: pending.options[0]?.value, commandIndex: i })
            }
        }
    })
    return writes
}

function resolveConflicts({ writes }: { writes: WriteIntent[] }): { applied: WriteIntent[], rejected: Array<{ write: WriteIntent, reason: string }> } {
    const byField = new Map<string, WriteIntent[]>()
    for (const w of writes) {
        const arr = byField.get(w.field) ?? []
        arr.push(w)
        byField.set(w.field, arr)
    }
    const applied: WriteIntent[] = []
    const rejected: Array<{ write: WriteIntent, reason: string }> = []
    for (const [, group] of byField) {
        if (group.length === 1) {
            applied.push(group[0])
            continue
        }
        const resolvers = group.filter(g => g.source === 'RESOLVE_PENDING')
        const setters = group.filter(g => g.source === 'SET_FIELDS')
        if (resolvers.length > 0) {
            applied.push(resolvers[0])
            for (const s of setters) rejected.push({ write: s, reason: 'p9b-conflict-resolve-wins' })
            for (const r of resolvers.slice(1)) rejected.push({ write: r, reason: 'p9b-duplicate-resolver' })
        }
        else {
            applied.push(group[0])
            for (const s of group.slice(1)) rejected.push({ write: s, reason: 'p9b-duplicate-setter' })
        }
    }
    return { applied, rejected }
}

function newEventBase({ turnId, sessionId, flowRunId, sessionSequence }: { turnId: string, sessionId: string, flowRunId: string, sessionSequence: string }): Pick<InteractiveFlowTurnEvent, 'outboxEventId' | 'turnId' | 'sessionId' | 'flowRunId' | 'sessionSequence' | 'timestamp'> {
    return {
        outboxEventId: randomUUID(),
        turnId,
        sessionId,
        flowRunId,
        sessionSequence,
        timestamp: new Date().toISOString(),
    }
}

function buildTurnEvents({ accepted, rejected, state, turnContext, infoIntents }: BuildEventsInput): InteractiveFlowTurnEvent[] {
    const out: InteractiveFlowTurnEvent[] = []
    let localSeq = BigInt(turnContext.sessionSequenceStart)
    function nextSeq(): string {
        const v = localSeq.toString()
        localSeq = localSeq + 1n
        return v
    }
    for (const cmd of accepted) {
        if (cmd.type === 'SET_FIELDS') {
            for (const u of cmd.updates) {
                out.push({
                    ...newEventBase({ ...turnContext, sessionSequence: nextSeq() }),
                    kind: 'FIELD_EXTRACTED',
                    payload: { field: u.field, value: u.value, evidence: u.evidence, previous: state[u.field] ?? null },
                })
            }
        }
        else if (cmd.type === 'ANSWER_META') {
            out.push({
                ...newEventBase({ ...turnContext, sessionSequence: nextSeq() }),
                kind: 'META_ANSWERED',
                payload: { kind: cmd.kind, message: cmd.message ?? null },
            })
        }
        else if (cmd.type === 'ANSWER_INFO') {
            const intent = infoIntents.find(i => i.id === cmd.infoIntent)
            out.push({
                ...newEventBase({ ...turnContext, sessionSequence: nextSeq() }),
                kind: 'INFO_ANSWERED',
                payload: { infoIntent: cmd.infoIntent, citedFields: cmd.citedFields, rendererKey: intent?.rendererKey ?? null },
            })
        }
        else if (cmd.type === 'REQUEST_CANCEL') {
            out.push({
                ...newEventBase({ ...turnContext, sessionSequence: nextSeq() }),
                kind: 'CANCEL_REQUESTED',
                payload: { reason: cmd.reason ?? null },
            })
        }
        else if (cmd.type === 'RESOLVE_PENDING') {
            const kind: InteractiveFlowTurnEvent['kind'] = cmd.pendingType === 'pending_cancel'
                ? (cmd.decision === 'accept' ? 'CANCEL_CONFIRMED' : 'CANCEL_REJECTED')
                : (cmd.decision === 'accept' ? 'OVERWRITE_CONFIRMED' : 'OVERWRITE_REJECTED')
            out.push({
                ...newEventBase({ ...turnContext, sessionSequence: nextSeq() }),
                kind,
                payload: { pendingType: cmd.pendingType, decision: cmd.decision },
            })
        }
        else if (cmd.type === 'REPROMPT') {
            out.push({
                ...newEventBase({ ...turnContext, sessionSequence: nextSeq() }),
                kind: 'REPROMPT_EMITTED',
                payload: { reason: cmd.reason },
            })
        }
    }
    for (const r of rejected) {
        out.push({
            ...newEventBase({ ...turnContext, sessionSequence: nextSeq() }),
            kind: 'FIELD_REJECTED',
            payload: { commandType: r.command.type, reason: r.reason },
        })
    }
    out.push({
        ...newEventBase({ ...turnContext, sessionSequence: nextSeq() }),
        kind: 'TURN_COMMITTED',
        payload: { acceptedCount: accepted.length, rejectedCount: rejected.length },
    })
    return out
}

function computeStateDiff({ applied }: { applied: WriteIntent[] }): Record<string, unknown> {
    const diff: Record<string, unknown> = {}
    for (const w of applied) {
        diff[w.field] = w.value
    }
    return diff
}

function computePendingDiff({ accepted, currentPending, newRequestCancelReason, now }: {
    accepted: ConversationCommand[]
    currentPending: PendingInteraction | null
    newRequestCancelReason: string | null
    now: Date
}): { next: PendingInteraction | null } {
    const hasRequestCancel = accepted.some(c => c.type === 'REQUEST_CANCEL')
    const hasResolve = accepted.find(c => c.type === 'RESOLVE_PENDING')

    if (hasRequestCancel) {
        return {
            next: {
                type: 'pending_cancel',
                reason: newRequestCancelReason ?? undefined,
                createdAt: now.toISOString(),
            },
        }
    }
    if (hasResolve && hasResolve.type === 'RESOLVE_PENDING') {
        return { next: null }
    }
    return { next: currentPending }
}

function buildMessageOut({ accepted, infoIntents, state, locale }: BuildMessageOutInput): InterpretTurnMessageOut {
    if (accepted.length === 0) {
        return { preDagAck: infoRenderer.buildAck({ kind: 'reprompt' }), kind: 'reprompt' }
    }
    const primary = pickPrimary(accepted)
    switch (primary.type) {
        case 'SET_FIELDS':
            return { preDagAck: infoRenderer.buildAck({ kind: 'ack-only' }), kind: 'ack-only' }
        case 'ASK_FIELD':
            return { preDagAck: infoRenderer.buildAck({ kind: 'ask-field', fieldName: primary.field }), kind: 'ask-field' }
        case 'ANSWER_META':
            return { preDagAck: primary.message ?? infoRenderer.buildAck({ kind: 'meta-answer' }), kind: 'meta-answer' }
        case 'ANSWER_INFO': {
            const intent = infoIntents.find(i => i.id === primary.infoIntent)
            if (!intent) return { preDagAck: infoRenderer.buildAck({ kind: 'reprompt' }), kind: 'reprompt' }
            const rendered = infoRenderer.renderAnswer({ intent, state, citedFields: primary.citedFields, locale: locale ?? 'it' })
            return rendered.ok
                ? { preDagAck: rendered.text, kind: 'info-answer' }
                : { preDagAck: infoRenderer.buildAck({ kind: 'reprompt' }), kind: 'reprompt' }
        }
        case 'REQUEST_CANCEL':
            return { preDagAck: infoRenderer.buildAck({ kind: 'cancel-request' }), kind: 'cancel-request' }
        case 'RESOLVE_PENDING':
            if (primary.pendingType === 'pending_cancel' && primary.decision === 'accept') {
                return { preDagAck: infoRenderer.buildAck({ kind: 'cancel-confirmed' }), kind: 'cancel-confirmed' }
            }
            return { preDagAck: infoRenderer.buildAck({ kind: 'ack-only' }), kind: 'ack-only' }
        case 'REPROMPT':
            return { preDagAck: infoRenderer.buildAck({ kind: 'reprompt' }), kind: 'reprompt' }
        default:
            return { preDagAck: infoRenderer.buildAck({ kind: 'reprompt' }), kind: 'reprompt' }
    }
}

function pickPrimary(accepted: ConversationCommand[]): ConversationCommand {
    const priority: ConversationCommand['type'][] = ['REPROMPT', 'REQUEST_CANCEL', 'RESOLVE_PENDING', 'ANSWER_INFO', 'ANSWER_META', 'ASK_FIELD', 'SET_FIELDS']
    for (const t of priority) {
        const found = accepted.find(c => c.type === t)
        if (found) return found
    }
    return accepted[0]
}

function buildPolicyDecisions({ accepted, rejected }: { accepted: ConversationCommand[], rejected: Array<{ command: ConversationCommand, reason: string }> }): InterpretTurnPolicyDecision[] {
    return [
        ...accepted.map((c): InterpretTurnPolicyDecision => ({ command: c, decision: 'accepted' })),
        ...rejected.map((r): InterpretTurnPolicyDecision => ({ command: r.command, decision: 'rejected', reason: r.reason })),
    ]
}

export const commandDispatcher = {
    collectWriteIntents,
    resolveConflicts,
    buildTurnEvents,
    computeStateDiff,
    computePendingDiff,
    buildMessageOut,
    buildPolicyDecisions,
    pickPrimary,
}

export type BuildEventsInput = {
    accepted: ConversationCommand[]
    rejected: Array<{ command: ConversationCommand, reason: string }>
    state: Record<string, unknown>
    infoIntents: InfoIntent[]
    turnContext: {
        turnId: string
        sessionId: string
        flowRunId: string
        sessionSequenceStart: string
    }
}

export type BuildMessageOutInput = {
    accepted: ConversationCommand[]
    infoIntents: InfoIntent[]
    state: Record<string, unknown>
    locale?: string
}

export type MessageKind = InterpretTurnMessageKind

export type { FieldUpdate, WriteIntent }
