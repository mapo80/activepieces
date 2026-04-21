import { normalization } from './normalization'

const CONFIRM_KEYWORDS_RE = /\b(si confermo|confermo|si procedi|procedi|va bene|d ?accordo|accetto|ok|si|yes|confirmed|confirm|affermativo)\b/
const REJECT_KEYWORDS_RE = /\b(no|nego|negativo|rifiuto|annulla|cancel|cancella|interrompi|non volevo|non era|pero no|no era)\b/
const ORDINAL_IT_MAP: Record<string, number> = {
    primo: 1, prima: 1,
    secondo: 2, seconda: 2,
    terzo: 3, terza: 3,
    quarto: 4, quarta: 4,
    quinto: 5, quinta: 5,
    sesto: 6, sesta: 6,
    settimo: 7, settima: 7,
    ottavo: 8, ottava: 8,
    nono: 9, nona: 9,
    decimo: 10, decima: 10,
}

function parseOrdinal({ message }: { message: string }): number | null {
    const normalized = normalization.normalize(message)
    const ultimoMatch = /\b(l['']\s*)?ultim[oa]\b/.exec(normalized)
    if (ultimoMatch) return -1
    for (const [word, num] of Object.entries(ORDINAL_IT_MAP)) {
        const regex = new RegExp(`\\b(il |la |lo )?${word}\\b`)
        if (regex.test(normalized)) return num
    }
    const firstMatch = /\b(il |la |lo )?prim[oa]\b/.exec(normalized)
    if (firstMatch) return 1
    const numberMatch = /\b(il |la |lo )?#?(\d{1,3})\b/.exec(normalized)
    if (numberMatch) {
        const n = +numberMatch[2]
        if (n >= 1) return n
    }
    return null
}

function resolveFromPendingInteraction({ message, pending }: {
    message: string
    pending: PendingInteraction
}): PendingResolutionResult {
    const normalized = normalization.normalize(message)

    if (pending.type === 'confirm_binary') {
        if (CONFIRM_KEYWORDS_RE.test(normalized)) {
            return {
                outcome: 'accept',
                field: pending.field,
                value: pending.target,
                evidence: firstMatchText({ regex: CONFIRM_KEYWORDS_RE, normalized, original: message }),
            }
        }
        if (REJECT_KEYWORDS_RE.test(normalized)) {
            return {
                outcome: 'reject',
                field: pending.field,
                evidence: firstMatchText({ regex: REJECT_KEYWORDS_RE, normalized, original: message }),
            }
        }
        return { outcome: 'no-match' }
    }

    if (pending.type === 'pick_from_list') {
        const ordinal = parseOrdinal({ message })
        if (ordinal !== null) {
            const idx = ordinal === -1 ? pending.options.length - 1 : ordinal - 1
            if (idx >= 0 && idx < pending.options.length) {
                return {
                    outcome: 'accept',
                    field: pending.field,
                    value: pending.options[idx].value,
                    evidence: extractOrdinalText({ ordinal, normalized, original: message }),
                }
            }
            return { outcome: 'out-of-range' }
        }
        for (const opt of pending.options) {
            const optNorm = normalization.normalize(opt.label)
            if (optNorm.length >= 2 && normalized.includes(optNorm)) {
                return {
                    outcome: 'accept',
                    field: pending.field,
                    value: opt.value,
                    evidence: opt.label,
                }
            }
            const tokens = optNorm.split(/\s+/).filter(t => t.length >= 4)
            for (const tok of tokens) {
                const regex = new RegExp(`\\b${escapeRegExp(tok)}\\b`)
                if (regex.test(normalized)) {
                    return {
                        outcome: 'accept',
                        field: pending.field,
                        value: opt.value,
                        evidence: tok,
                    }
                }
            }
        }
        return { outcome: 'no-match' }
    }

    if (pending.type === 'pending_overwrite') {
        if (CONFIRM_KEYWORDS_RE.test(normalized)) {
            return {
                outcome: 'accept',
                field: pending.field,
                value: pending.newValue,
                evidence: firstMatchText({ regex: CONFIRM_KEYWORDS_RE, normalized, original: message }),
            }
        }
        if (REJECT_KEYWORDS_RE.test(normalized)) {
            return {
                outcome: 'reject',
                field: pending.field,
                evidence: firstMatchText({ regex: REJECT_KEYWORDS_RE, normalized, original: message }),
            }
        }
        return { outcome: 'no-match' }
    }

    return { outcome: 'no-match' }
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function firstMatchText({ regex, normalized, original }: { regex: RegExp; normalized: string; original: string }): string {
    const m = regex.exec(normalized)
    if (!m) return original.slice(0, 40)
    return m[0]
}

function extractOrdinalText({ ordinal, normalized, original }: { ordinal: number; normalized: string; original: string }): string {
    if (ordinal === -1) return 'ultimo'
    const word = Object.entries(ORDINAL_IT_MAP).find(([, n]) => n === ordinal)?.[0]
    if (word) return word
    return `${ordinal}`
}

export const pendingInteractionResolver = {
    parseOrdinal,
    resolve: resolveFromPendingInteraction,
}

export type PendingInteraction =
    | { type: 'confirm_binary'; field: string; target: unknown; nodeId: string }
    | { type: 'pick_from_list'; field: string; options: Array<{ ordinal: number; label: string; value: unknown }>; nodeId: string }
    | { type: 'pending_overwrite'; field: string; oldValue: unknown; newValue: unknown; nodeId: string }
    | { type: 'open_text'; field: string; nodeId: string }

export type PendingResolutionResult =
    | { outcome: 'accept'; field: string; value: unknown; evidence: string }
    | { outcome: 'reject'; field: string; evidence: string }
    | { outcome: 'out-of-range' }
    | { outcome: 'no-match' }
