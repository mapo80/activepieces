import { normalization } from './normalization'

const CORRECTION_CUE_RE = /\b(scusa|invece|anzi|non era|non volevo|cercavo|volevo|piuttosto|in effetti|i meant|meant to say|instead|sorry|actually)\b/

function detectCueOfCorrection({ message }: { message: string }): CueDetection {
    const normalized = normalization.normalize(message)
    const m = CORRECTION_CUE_RE.exec(normalized)
    if (m) {
        return { present: true, cue: m[0] }
    }
    return { present: false }
}

function decideOverwrite({ field, oldValue, newValue, cuePresent, plausible }: {
    field: string
    oldValue: unknown
    newValue: unknown
    cuePresent: boolean
    plausible: boolean
}): OverwriteDecision {
    if (isEmpty(oldValue)) {
        return { action: 'accept', reason: 'first-fill' }
    }
    if (valuesEqual({ a: oldValue, b: newValue })) {
        return { action: 'accept', reason: 'no-op' }
    }
    if (!plausible) {
        return { action: 'reject', reason: 'new-value-not-plausible' }
    }
    if (cuePresent) {
        return { action: 'accept', reason: 'correction-cue' }
    }
    return {
        action: 'confirm',
        reason: 'pending-overwrite',
        pendingOverwrite: { field, oldValue, newValue },
    }
}

function isEmpty(value: unknown): boolean {
    if (value === null || value === undefined) return true
    if (typeof value === 'string' && value.trim().length === 0) return true
    if (Array.isArray(value) && value.length === 0) return true
    return false
}

function valuesEqual({ a, b }: { a: unknown; b: unknown }): boolean {
    if (a === b) return true
    if (typeof a === 'string' && typeof b === 'string') {
        return normalization.normalize(a) === normalization.normalize(b)
    }
    try {
        return JSON.stringify(a) === JSON.stringify(b)
    }
    catch {
        return false
    }
}

function shouldPromoteTurnAffirmed({ currentNodeType, pendingOverwriteActive }: {
    currentNodeType: 'CONFIRM' | 'USER_INPUT' | 'TOOL' | 'BRANCH' | undefined
    pendingOverwriteActive: boolean
}): boolean {
    if (currentNodeType === 'CONFIRM') return true
    if (pendingOverwriteActive) return true
    return false
}

export const overwritePolicy = {
    detectCueOfCorrection,
    decideOverwrite,
    isEmpty,
    valuesEqual,
    shouldPromoteTurnAffirmed,
}

export type CueDetection = { present: true; cue: string } | { present: false }

export type OverwriteDecision =
    | { action: 'accept'; reason: string }
    | { action: 'reject'; reason: string }
    | { action: 'confirm'; reason: string; pendingOverwrite: { field: string; oldValue: unknown; newValue: unknown } }
