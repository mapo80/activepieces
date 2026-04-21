import { normalization } from './normalization'

type Span = { start: number; end: number; kind?: string }

function parseNdg({ message }: { message: string }): PreParserMatch[] {
    const matches: PreParserMatch[] = []
    const regex = /\b(\d{6,10})\b/g
    let m: RegExpExecArray | null
    while ((m = regex.exec(message)) !== null) {
        matches.push({
            field: 'ndg',
            value: m[1],
            span: { start: m.index, end: m.index + m[0].length, kind: 'ndg' },
            evidence: m[0],
        })
    }
    return matches
}

function parseRapportoId({ message }: { message: string }): PreParserMatch[] {
    const matches: PreParserMatch[] = []
    const regex = /\b(\d{2}-\d{3}-\d{8})\b/g
    let m: RegExpExecArray | null
    while ((m = regex.exec(message)) !== null) {
        matches.push({
            field: 'rapportoId',
            value: m[1],
            span: { start: m.index, end: m.index + m[0].length, kind: 'rapportoId' },
            evidence: m[0],
        })
    }
    return matches
}

function parseAbsoluteDate({ message }: { message: string }): PreParserMatch[] {
    const matches: PreParserMatch[] = []
    const isoRegex = /\b(\d{4})-(\d{2})-(\d{2})\b/g
    let m: RegExpExecArray | null
    while ((m = isoRegex.exec(message)) !== null) {
        const [, year, month, day] = m
        if (!isValidCalendarDate({ year: +year, month: +month, day: +day })) continue
        matches.push({
            field: 'closureDate',
            value: `${year}-${month}-${day}`,
            span: { start: m.index, end: m.index + m[0].length, kind: 'closureDate' },
            evidence: m[0],
        })
    }

    const slashRegex = /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/g
    while ((m = slashRegex.exec(message)) !== null) {
        const [, dayStr, monthStr, yearStr] = m
        const day = +dayStr
        const month = +monthStr
        let year = +yearStr
        if (yearStr.length === 2) year += 2000
        if (!isValidCalendarDate({ year, month, day })) continue
        const value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        matches.push({
            field: 'closureDate',
            value,
            span: { start: m.index, end: m.index + m[0].length, kind: 'closureDate' },
            evidence: m[0],
        })
    }

    const monthMap: Record<string, number> = {
        gennaio: 1, gen: 1,
        febbraio: 2, feb: 2,
        marzo: 3, mar: 3,
        aprile: 4, apr: 4,
        maggio: 5, mag: 5,
        giugno: 6, giu: 6,
        luglio: 7, lug: 7,
        agosto: 8, ago: 8,
        settembre: 9, set: 9, sett: 9,
        ottobre: 10, ott: 10,
        novembre: 11, nov: 11,
        dicembre: 12, dic: 12,
    }
    const monthNames = Object.keys(monthMap).sort((a, b) => b.length - a.length).join('|')
    const monthRegex = new RegExp(
        `\\b(\\d{1,2})[\\s-]+(${monthNames})[\\s-]+(\\d{2,4})\\b`,
        'gi',
    )
    while ((m = monthRegex.exec(message)) !== null) {
        const [, dayStr, monthName, yearStr] = m
        const day = +dayStr
        const month = monthMap[monthName.toLowerCase()]
        let year = +yearStr
        if (yearStr.length === 2) year += 2000
        if (!isValidCalendarDate({ year, month, day })) continue
        const value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        matches.push({
            field: 'closureDate',
            value,
            span: { start: m.index, end: m.index + m[0].length, kind: 'closureDate' },
            evidence: m[0],
        })
    }

    return matches
}

function parseReasonCodeWithCue({ message }: { message: string }): PreParserMatch[] {
    const matches: PreParserMatch[] = []
    const regex = /\b(motivazione|codice|causale)\s+(\d{2})\b/gi
    let m: RegExpExecArray | null
    while ((m = regex.exec(message)) !== null) {
        matches.push({
            field: 'closureReasonCode',
            value: m[2],
            span: { start: m.index, end: m.index + m[0].length, kind: 'closureReasonCode' },
            evidence: m[0],
        })
    }
    return matches
}

function parseConfirmationKeyword({ message }: { message: string }): PreParserMatch | null {
    const normalized = normalization.normalize(message)
    const patterns = [
        /\bsi confermo\b/,
        /\bconfermo\b/,
        /\bsi procedi\b/,
        /\bprocedi\b/,
        /\bva bene\b/,
        /\bd[ '']?accordo\b/,
        /\baccetto\b/,
        /\bok\b/,
        /\bsi$/,
        /^si\b/,
    ]
    for (const p of patterns) {
        const m = p.exec(normalized)
        if (m) {
            return {
                field: 'turnAffirmed',
                value: true,
                span: { start: 0, end: message.length, kind: 'confirmation' },
                evidence: m[0],
            }
        }
    }
    return null
}

function runPreParser({ message }: { message: string }): PreParserResult {
    const candidates: PreParserMatch[] = []
    candidates.push(...parseRapportoId({ message }))
    const dateMatches = parseAbsoluteDate({ message })
    candidates.push(...dateMatches)
    const reasonMatches = parseReasonCodeWithCue({ message })
    candidates.push(...reasonMatches)
    const ndgMatches = parseNdg({ message })
    for (const match of ndgMatches) {
        if (isSpanInsideReserved({ span: match.span, reservedSpans: candidates.map(c => c.span) })) continue
        candidates.push(match)
    }
    const confirmation = parseConfirmationKeyword({ message })
    if (confirmation) candidates.push(confirmation)

    return {
        candidates,
        reservedSpans: candidates.map(c => c.span),
    }
}

function isValidCalendarDate({ year, month, day }: { year: number; month: number; day: number }): boolean {
    if (month < 1 || month > 12) return false
    if (day < 1 || day > 31) return false
    if (year < 1900 || year > 2100) return false
    const date = new Date(year, month - 1, day)
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

function isSpanInsideReserved({ span, reservedSpans }: { span: Span; reservedSpans: Span[] }): boolean {
    return reservedSpans.some(r => span.start >= r.start && span.end <= r.end)
}

export const preParser = {
    parseNdg,
    parseRapportoId,
    parseAbsoluteDate,
    parseReasonCodeWithCue,
    parseConfirmationKeyword,
    run: runPreParser,
    isValidCalendarDate,
}

export type PreParserMatch = {
    field: string
    value: unknown
    span: Span
    evidence: string
}

export type PreParserResult = {
    candidates: PreParserMatch[]
    reservedSpans: Span[]
}
