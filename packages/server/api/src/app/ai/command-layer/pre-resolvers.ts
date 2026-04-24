import { ConversationCommand, InteractiveFlowTurnEvent, PendingInteraction } from '@activepieces/shared'

const PENDING_CANCEL_TTL_MS = 60_000

const ACCEPT_KEYWORDS_IT = ['sì', 'si', 'sicuro', 'certo', 'ok', 'okay', 'conferma', 'confermo', 'procedi']
const ACCEPT_KEYWORDS_EN = ['yes', 'confirm', 'ok', 'okay', 'sure', 'proceed']
const REJECT_KEYWORDS_IT = ['no', 'aspetta', 'annulla invece no', 'non voglio annullare', 'continuiamo', 'riprendi']
const REJECT_KEYWORDS_EN = ['no', 'wait', 'don\'t cancel', 'continue']

const CANCEL_TRIGGERS_IT = ['annulla', 'annullare', 'cancella', 'ricomincio', 'basta', 'stop']
const CANCEL_TRIGGERS_EN = ['cancel', 'abort', 'stop', 'restart', 'give up']

function normalize(text: string): string {
    return text.trim().toLowerCase()
}

function matchesKeyword(message: string, keywords: string[]): boolean {
    const normalized = normalize(message)
    return keywords.some(k => normalized === k || normalized.includes(` ${k} `) || normalized.startsWith(`${k} `) || normalized.endsWith(` ${k}`) || normalized === k)
}

function resolvePendingTtl({ pending, now }: { pending: PendingInteraction | null, now: Date }): { cleared: boolean, event?: Partial<InteractiveFlowTurnEvent> } {
    if (!pending || pending.type !== 'pending_cancel') return { cleared: false }
    const age = now.getTime() - new Date(pending.createdAt).getTime()
    if (age > PENDING_CANCEL_TTL_MS) {
        return {
            cleared: true,
            event: { kind: 'CANCEL_TTL_EXPIRED', payload: { reason: pending.reason ?? null } },
        }
    }
    return { cleared: false }
}

function resolvePendingCancel({ message, pending }: { message: string, pending: PendingInteraction }): ConversationCommand[] | null {
    if (pending.type !== 'pending_cancel') return null
    if (matchesKeyword(message, ACCEPT_KEYWORDS_IT) || matchesKeyword(message, ACCEPT_KEYWORDS_EN)) {
        return [{ type: 'RESOLVE_PENDING', decision: 'accept', pendingType: 'pending_cancel' }]
    }
    if (matchesKeyword(message, REJECT_KEYWORDS_IT) || matchesKeyword(message, REJECT_KEYWORDS_EN)) {
        return [{ type: 'RESOLVE_PENDING', decision: 'reject', pendingType: 'pending_cancel' }]
    }
    return null
}

function resolveExplicitCancel({ message, pending }: { message: string, pending: PendingInteraction | null }): ConversationCommand[] | null {
    if (pending?.type === 'pending_cancel') return null
    if (matchesKeyword(message, CANCEL_TRIGGERS_IT) || matchesKeyword(message, CANCEL_TRIGGERS_EN)) {
        return [{ type: 'REQUEST_CANCEL', reason: 'user-initiated' }]
    }
    return null
}

function resolvePendingConfirm({ message, pending }: { message: string, pending: PendingInteraction }): ConversationCommand[] | null {
    if (pending.type !== 'confirm_binary' && pending.type !== 'pending_overwrite') return null
    if (matchesKeyword(message, ACCEPT_KEYWORDS_IT) || matchesKeyword(message, ACCEPT_KEYWORDS_EN)) {
        return [{ type: 'RESOLVE_PENDING', decision: 'accept', pendingType: pending.type }]
    }
    if (matchesKeyword(message, REJECT_KEYWORDS_IT) || matchesKeyword(message, REJECT_KEYWORDS_EN)) {
        return [{ type: 'RESOLVE_PENDING', decision: 'reject', pendingType: pending.type }]
    }
    return null
}

function resolve({ message, pending, now }: ResolveInput): ResolveResult {
    const events: Array<Partial<InteractiveFlowTurnEvent>> = []

    const ttl = resolvePendingTtl({ pending, now })
    const pendingAfterTtl = ttl.cleared ? null : pending
    if (ttl.event) events.push(ttl.event)

    if (pendingAfterTtl?.type === 'pending_cancel') {
        const cmds = resolvePendingCancel({ message, pending: pendingAfterTtl })
        if (cmds) return { ok: true, commands: cmds, clearedPending: false, events }
        return { ok: false, clearedPending: false, events }
    }

    if (pendingAfterTtl && (pendingAfterTtl.type === 'confirm_binary' || pendingAfterTtl.type === 'pending_overwrite')) {
        const cmds = resolvePendingConfirm({ message, pending: pendingAfterTtl })
        if (cmds) return { ok: true, commands: cmds, clearedPending: false, events }
    }

    const cancelCmds = resolveExplicitCancel({ message, pending: pendingAfterTtl })
    if (cancelCmds) return { ok: true, commands: cancelCmds, clearedPending: ttl.cleared, events }

    return { ok: false, clearedPending: ttl.cleared, events }
}

export const preResolvers = {
    resolve,
    PENDING_CANCEL_TTL_MS,
}

export type ResolveInput = {
    message: string
    pending: PendingInteraction | null
    now: Date
}

export type ResolveResult =
    | { ok: true, commands: ConversationCommand[], clearedPending: boolean, events: Array<Partial<InteractiveFlowTurnEvent>> }
    | { ok: false, clearedPending: boolean, events: Array<Partial<InteractiveFlowTurnEvent>> }
