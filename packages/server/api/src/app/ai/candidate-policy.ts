import { normalization } from './normalization'

const CONVERSATIONAL_BLOCKLIST_NAME = new Set([
    'ciao', 'salve', 'buongiorno', 'buonasera', 'grazie', 'prego',
    'procedere', 'procedi', 'procede', 'procediamo',
    'conferma', 'confermo', 'confermi', 'conferm',
    'ripeti', 'ripetimi', 'ripetere', 'ripetizione',
    'dimmi', 'dammi', 'dammelo', 'mostra', 'mostrami', 'mostrare',
    'elenca', 'elenco', 'lista', 'rapporto', 'rapporti', 'conto', 'conti',
    'motivazione', 'motivazioni', 'pratica', 'pratiche',
    'va', 'bene', 'vabbene', 'ok', 'okay', 'accetto', 'accettabile',
    'avanti', 'continua', 'continuare', 'basta', 'stop',
    'capito', 'capisco', 'capire', 'non',
    'voglio', 'volevo', 'devo', 'deve', 'puoi', 'posso',
    'aiuto', 'aiutami', 'aiutare', 'help',
    'annulla', 'cancella', 'interrompi', 'cancel',
])

function verifyEvidence({ evidence, userMessage }: {
    evidence: string | undefined
    userMessage: string
}): { ok: true } | { ok: false, reason: string } {
    if (!evidence || evidence.trim().length < 2) {
        return { ok: false, reason: 'evidence-too-short-or-missing' }
    }
    const normalized = normalization.normalizePreservingSpans(userMessage)
    const located = normalization.locateEvidence({ evidence, normalized })
    if (!located.matched) {
        return { ok: false, reason: `evidence-${located.reason}` }
    }
    return { ok: true }
}

function verifyFieldPlausibility({ field, value, rules }: {
    field: string
    value: unknown
    rules?: FieldPlausibilityRules
}): { ok: true } | { ok: false, reason: string } {
    if (value === null || value === undefined) return { ok: false, reason: 'nil-value' }

    if (field === 'customerName') {
        if (typeof value !== 'string') return { ok: false, reason: 'not-string' }
        const trimmed = value.trim()
        if (trimmed.length < 2) return { ok: false, reason: 'customerName-too-short' }
        if (!/^[A-Za-zÀ-ÿ' \-]+$/.test(trimmed)) {
            return { ok: false, reason: 'customerName-invalid-chars' }
        }
        const tokens = trimmed.toLowerCase().split(/\s+/)
        if (tokens.length < 1 || tokens.length > 4) {
            return { ok: false, reason: 'customerName-invalid-token-count' }
        }
        for (const tok of tokens) {
            if (CONVERSATIONAL_BLOCKLIST_NAME.has(tok)) {
                return { ok: false, reason: `customerName-blocklisted:${tok}` }
            }
        }
        return { ok: true }
    }

    if (rules?.minLength !== undefined) {
        if (typeof value !== 'string' || value.length < rules.minLength) {
            return { ok: false, reason: `minLength-${rules.minLength}-failed` }
        }
    }
    if (rules?.maxLength !== undefined) {
        if (typeof value !== 'string' || value.length > rules.maxLength) {
            return { ok: false, reason: `maxLength-${rules.maxLength}-failed` }
        }
    }
    if (rules?.pattern) {
        if (typeof value !== 'string' || !new RegExp(rules.pattern).test(value)) {
            return { ok: false, reason: 'pattern-failed' }
        }
    }
    return { ok: true }
}

function verifyDomain({ field, value, state, fieldSpec }: {
    field: string
    value: unknown
    state: Record<string, unknown>
    fieldSpec?: { enumFrom?: string, enumValueField?: string, parser?: string, pattern?: string }
}): { ok: true } | { ok: false, reason: string } {
    if (field === 'closureDate') {
        if (typeof value !== 'string') return { ok: false, reason: 'date-not-string' }
        const date = new Date(value)
        if (isNaN(date.getTime())) return { ok: false, reason: 'date-not-parseable' }
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const fiveYears = new Date(today)
        fiveYears.setFullYear(today.getFullYear() + 5)
        if (date < today) return { ok: false, reason: 'date-in-past' }
        if (date > fiveYears) return { ok: false, reason: 'date-too-far' }
        return { ok: true }
    }
    if (fieldSpec?.enumFrom && fieldSpec?.enumValueField) {
        const list = state[fieldSpec.enumFrom]
        if (!Array.isArray(list) || list.length === 0) {
            // Deferred validation: if the field declares a format pattern,
            // accept tentatively when the catalog is not yet populated. The
            // engine's reValidateEnumFields pass will enforce existence once
            // the producing tool has run. Pattern-mismatched values and
            // fields without a pattern stay rejected.
            if (fieldSpec.pattern && typeof value === 'string' && new RegExp(fieldSpec.pattern).test(value)) {
                return { ok: true }
            }
            return { ok: false, reason: 'enum-unavailable-in-state' }
        }
        const valueField = fieldSpec.enumValueField
        const allowed = list
            .map(item => (item && typeof item === 'object' ? (item as Record<string, unknown>)[valueField] : undefined))
            .filter(v => v !== undefined)
        if (!allowed.some(v => v === value)) {
            return { ok: false, reason: `not-in-state-${fieldSpec.enumFrom}` }
        }
    }
    return { ok: true }
}

function verifyFieldAdmissibility({ field, currentNode, identityFields = [], fieldSpec }: {
    field: string
    currentNode: NodeAdmissibilityDescriptor
    identityFields?: string[]
    fieldSpec?: { extractable?: boolean, extractionScope?: 'global' | 'node-local' }
}): { ok: true } | { ok: false, reason: string } {
    if (field === 'turnAffirmed') return { ok: true }
    // Global admissibility (default): extractable data fields are accepted at any node.
    // Trigger fields (e.g. `confirmed` committing a submit) opt-in to restriction via
    // extractionScope='node-local' and fall through to the per-node checks below.
    if (fieldSpec?.extractable === true && fieldSpec.extractionScope !== 'node-local') {
        return { ok: true }
    }
    if (currentNode.stateOutputs?.includes(field)) return { ok: true }
    if (identityFields.includes(field)) return { ok: true }
    if (currentNode.allowedExtraFields?.includes(field)) return { ok: true }
    return { ok: false, reason: `field-not-admissible-at-node-${currentNode.nodeId}` }
}

export const candidatePolicy = {
    verifyEvidence,
    verifyFieldPlausibility,
    verifyDomain,
    verifyFieldAdmissibility,
    CONVERSATIONAL_BLOCKLIST_NAME,
}

export type FieldPlausibilityRules = {
    minLength?: number
    maxLength?: number
    pattern?: string
}

export type NodeAdmissibilityDescriptor = {
    nodeId: string
    stateOutputs?: string[]
    allowedExtraFields?: string[]
}
