import { normalization } from './normalization'

const VAGUE_REFERENCE_RE = /\b(la stessa|le stesse|lo stesso|quella|quello|quelle|quelli|l[' ]?altra|l[' ]?altro|la solita|il solito|come prima|come l[' ]?altra volta|come quella volta|stessa di prima|stesso di prima)\b/

function resolve({ reasonText, closureReasons }: {
    reasonText: string
    closureReasons: ClosureReason[]
}): ResolutionResult {
    const normalized = normalization.normalize(reasonText)
    if (normalized.length === 0) {
        return { resolution: 'none' }
    }
    if (VAGUE_REFERENCE_RE.test(normalized)) {
        return { resolution: 'vague-rejected', reason: 'reference-too-vague' }
    }

    const codeMatch = /^(\d{2})$/.exec(normalized)
    if (codeMatch) {
        const code = codeMatch[1]
        const exact = closureReasons.find(r => r.codice === code)
        if (exact) return { resolution: 'unique', code: exact.codice, matchedBy: 'exact-code' }
        return { resolution: 'none' }
    }

    const descrExact = closureReasons.filter(r => normalization.normalize(r.descr) === normalized)
    if (descrExact.length === 1) {
        return { resolution: 'unique', code: descrExact[0].codice, matchedBy: 'exact-descr' }
    }

    const substringMatches = closureReasons.filter(r => {
        const d = normalization.normalize(r.descr)
        return d.includes(normalized) || normalized.includes(d)
    })
    if (substringMatches.length === 1) {
        return { resolution: 'unique', code: substringMatches[0].codice, matchedBy: 'substring' }
    }
    if (substringMatches.length > 1) {
        return {
            resolution: 'ambiguous',
            matches: substringMatches.map(r => ({ code: r.codice, descr: r.descr })),
        }
    }

    const tokenScores = computeTokenOverlapScores({ text: normalized, reasons: closureReasons })
    const ranked = tokenScores.sort((a, b) => b.score - a.score).filter(s => s.score > 0)
    if (ranked.length === 0) return { resolution: 'none' }
    const top = ranked[0]
    const runnerUp = ranked[1]
    if (!runnerUp || top.score >= runnerUp.score * 2) {
        return { resolution: 'unique', code: top.code, matchedBy: 'token-overlap' }
    }
    return {
        resolution: 'ambiguous',
        matches: ranked.slice(0, 5).map(r => ({ code: r.code, descr: r.descr })),
    }
}

function computeTokenOverlapScores({ text, reasons }: {
    text: string
    reasons: ClosureReason[]
}): Array<{ code: string; descr: string; score: number }> {
    const userTokens = new Set(text.split(/\s+/).filter(t => t.length >= 3))
    return reasons.map(r => {
        const reasonTokens = new Set(normalization.normalize(r.descr).split(/\s+/).filter(t => t.length >= 3))
        let overlap = 0
        for (const t of userTokens) {
            if (reasonTokens.has(t)) overlap++
        }
        return { code: r.codice, descr: r.descr, score: overlap }
    })
}

export const reasonResolver = {
    resolve,
}

export type ClosureReason = {
    codice: string
    descr: string
}

export type ResolutionResult =
    | { resolution: 'unique'; code: string; matchedBy: 'exact-code' | 'exact-descr' | 'substring' | 'token-overlap' }
    | { resolution: 'none' }
    | { resolution: 'vague-rejected'; reason: string }
    | { resolution: 'ambiguous'; matches: Array<{ code: string; descr: string }> }
