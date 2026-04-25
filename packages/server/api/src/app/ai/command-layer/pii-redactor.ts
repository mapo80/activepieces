import { InteractiveFlowStateField } from '@activepieces/shared'

const PHONE_RE = /(\+?\d[\d\s\-().]{6,})/g
const EMAIL_RE = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g
const FISCAL_CODE_RE = /\b([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z])\b/g
const IBAN_RE = /\b([A-Z]{2}\d{2}[A-Z0-9]{11,30})\b/g
const NDG_RE = /\b(\d{6,10})\b/g

const REDACTION = '[REDACTED]'

function redactString(input: string): string {
    return input
        .replace(EMAIL_RE, REDACTION)
        .replace(FISCAL_CODE_RE, REDACTION)
        .replace(IBAN_RE, REDACTION)
        .replace(PHONE_RE, REDACTION)
        .replace(NDG_RE, REDACTION)
}

function redactValue({ value, depth }: { value: unknown, depth: number }): unknown {
    if (depth > 6) return '[DEPTH_LIMIT]'
    if (typeof value === 'string') return redactString(value)
    if (Array.isArray(value)) return value.map(item => redactValue({ value: item, depth: depth + 1 }))
    if (value !== null && typeof value === 'object') {
        const obj = value as Record<string, unknown>
        const out: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(obj)) {
            out[k] = redactValue({ value: v, depth: depth + 1 })
        }
        return out
    }
    return value
}

function redactState({ state, stateFields }: {
    state: Record<string, unknown>
    stateFields: InteractiveFlowStateField[]
}): Record<string, unknown> {
    const sensitive = new Set(stateFields.filter(f => f.sensitive === true).map(f => f.name))
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(state)) {
        if (sensitive.has(k)) {
            out[k] = REDACTION
            continue
        }
        out[k] = redactValue({ value: v, depth: 0 })
    }
    return out
}

function redactPayload(payload: Record<string, unknown>): Record<string, unknown> {
    return redactValue({ value: payload, depth: 0 }) as Record<string, unknown>
}

export const piiRedactor = {
    redactString,
    redactState,
    redactPayload,
    redactValue,
    REDACTION,
}
