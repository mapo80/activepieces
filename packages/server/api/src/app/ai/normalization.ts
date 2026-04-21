function normalize(text: string): string {
    if (text === undefined || text === null) return ''
    return text
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[\u2018\u2019\u0060\u00b4]/g, '\'')
        .replace(/[\u2013\u2014]/g, '-')
        .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
}

function normalizePreservingSpans(text: string): NormalizedText {
    const normalized = normalize(text)
    return {
        original: text,
        normalized,
        originalToNormalizedMap: buildPositionMap({ original: text, normalized }),
    }
}

function buildPositionMap({ original, normalized }: { original: string, normalized: string }): number[] {
    const map: number[] = []
    let normalizedIdx = 0
    for (let i = 0; i < original.length; i++) {
        const charNorm = normalize(original[i])
        if (charNorm.length === 0) {
            map.push(Math.min(normalizedIdx, normalized.length))
            continue
        }
        map.push(normalizedIdx)
        normalizedIdx += charNorm.length
    }
    return map
}

function locateEvidence({ evidence, normalized }: {
    evidence: string
    normalized: NormalizedText
}): LocatedEvidence {
    const needle = normalize(evidence)
    if (needle.length < 2) {
        return { matched: false, reason: 'evidence-too-short' }
    }
    const haystack = normalized.normalized
    const idx = haystack.indexOf(needle)
    if (idx < 0) {
        return { matched: false, reason: 'not-substring' }
    }
    return { matched: true, normalizedSpan: { start: idx, end: idx + needle.length } }
}

function spansOverlap({ a, b }: { a: Span, b: Span }): boolean {
    return a.start < b.end && b.start < a.end
}

function unionSpans({ spans }: { spans: Span[] }): Span[] {
    if (spans.length === 0) return []
    const sorted = [...spans].sort((x, y) => x.start - y.start)
    const result: Span[] = [sorted[0]]
    for (let i = 1; i < sorted.length; i++) {
        const last = result[result.length - 1]
        const current = sorted[i]
        if (current.start <= last.end) {
            result[result.length - 1] = { start: last.start, end: Math.max(last.end, current.end) }
        }
        else {
            result.push(current)
        }
    }
    return result
}

function removeSpans({ text, spans, replacement = ' ' }: {
    text: string
    spans: Span[]
    replacement?: string
}): string {
    if (spans.length === 0) return text
    const merged = unionSpans({ spans })
    let out = ''
    let cursor = 0
    for (const span of merged) {
        out += text.slice(cursor, span.start) + replacement
        cursor = span.end
    }
    out += text.slice(cursor)
    return out
}

export const normalization = {
    normalize,
    normalizePreservingSpans,
    locateEvidence,
    spansOverlap,
    unionSpans,
    removeSpans,
}

export type Span = {
    start: number
    end: number
    kind?: string
}

export type NormalizedText = {
    original: string
    normalized: string
    originalToNormalizedMap: number[]
}

export type LocatedEvidence =
    | { matched: true, normalizedSpan: Span }
    | { matched: false, reason: 'evidence-too-short' | 'not-substring' }
