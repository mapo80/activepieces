import { describe, expect, it } from 'vitest'
import { preParser } from '../../../../src/app/ai/pre-parser'

describe('preParser.parseNdg', () => {
    it('matches 6-digit NDG', () => {
        const r = preParser.parseNdg({ message: 'il mio NDG è 123456' })
        expect(r).toHaveLength(1)
        expect(r[0].value).toBe('123456')
    })

    it('matches 10-digit NDG', () => {
        const r = preParser.parseNdg({ message: 'NDG 1234567890' })
        expect(r).toHaveLength(1)
        expect(r[0].value).toBe('1234567890')
    })

    it('does not match 5-digit (too short)', () => {
        const r = preParser.parseNdg({ message: 'codice 12345' })
        expect(r).toHaveLength(0)
    })

    it('does not match 11-digit (too long)', () => {
        const r = preParser.parseNdg({ message: 'codice 12345678901' })
        expect(r).toHaveLength(0)
    })

    it('matches multiple NDGs in one message', () => {
        const r = preParser.parseNdg({ message: 'NDG 111111 e NDG 222222' })
        expect(r).toHaveLength(2)
    })

    it('returns span positions', () => {
        const msg = 'NDG 11255521 rapporto'
        const r = preParser.parseNdg({ message: msg })
        expect(r[0].span.start).toBe(4)
        expect(r[0].span.end).toBe(12)
    })
})

describe('preParser.parseRapportoId', () => {
    it('matches correct format', () => {
        const r = preParser.parseRapportoId({ message: 'rapporto 01-034-00392400' })
        expect(r).toHaveLength(1)
        expect(r[0].value).toBe('01-034-00392400')
    })

    it('does not match wrong format (missing digits)', () => {
        const r = preParser.parseRapportoId({ message: 'rapporto 01-34-00392400' })
        expect(r).toHaveLength(0)
    })

    it('does not match wrong format (extra digits)', () => {
        const r = preParser.parseRapportoId({ message: 'rapporto 011-034-00392400' })
        expect(r).toHaveLength(0)
    })

    it('records span correctly', () => {
        const r = preParser.parseRapportoId({ message: 'rapporto 01-034-00392400 ok' })
        expect(r[0].span.start).toBe(9)
        expect(r[0].span.end).toBe(24)
    })
})

describe('preParser.parseAbsoluteDate', () => {
    it('matches ISO date', () => {
        const r = preParser.parseAbsoluteDate({ message: 'data 2026-04-15' })
        expect(r).toHaveLength(1)
        expect(r[0].value).toBe('2026-04-15')
    })

    it('matches IT slash format (DD/MM/YYYY)', () => {
        const r = preParser.parseAbsoluteDate({ message: 'data 15/04/2026' })
        expect(r).toHaveLength(1)
        expect(r[0].value).toBe('2026-04-15')
    })

    it('matches IT slash format with 2-digit year', () => {
        const r = preParser.parseAbsoluteDate({ message: 'data 15/04/26' })
        expect(r).toHaveLength(1)
        expect(r[0].value).toBe('2026-04-15')
    })

    it('matches IT full month name', () => {
        const r = preParser.parseAbsoluteDate({ message: 'il 20 aprile 2026' })
        expect(r).toHaveLength(1)
        expect(r[0].value).toBe('2026-04-20')
    })

    it('matches abbreviated month (apr)', () => {
        const r = preParser.parseAbsoluteDate({ message: 'data 20 apr 2026' })
        expect(r).toHaveLength(1)
        expect(r[0].value).toBe('2026-04-20')
    })

    it('matches hyphenated form (20-apr-2026)', () => {
        const r = preParser.parseAbsoluteDate({ message: 'data 20-apr-2026' })
        expect(r).toHaveLength(1)
        expect(r[0].value).toBe('2026-04-20')
    })

    it('REJECTS "domani" in v1 (no relative dates)', () => {
        const r = preParser.parseAbsoluteDate({ message: 'domani' })
        expect(r).toHaveLength(0)
    })

    it('REJECTS "fine mese" in v1', () => {
        const r = preParser.parseAbsoluteDate({ message: 'entro fine mese' })
        expect(r).toHaveLength(0)
    })

    it('REJECTS "il 20" without month', () => {
        const r = preParser.parseAbsoluteDate({ message: 'il 20' })
        expect(r).toHaveLength(0)
    })

    it('REJECTS "ventiquattro aprile"', () => {
        const r = preParser.parseAbsoluteDate({ message: 'il ventiquattro aprile' })
        expect(r).toHaveLength(0)
    })

    it('rejects invalid calendar date (Feb 30)', () => {
        const r = preParser.parseAbsoluteDate({ message: 'data 2026-02-30' })
        expect(r).toHaveLength(0)
    })

    it('rejects invalid slash date (31/02)', () => {
        const r = preParser.parseAbsoluteDate({ message: 'data 31/02/2026' })
        expect(r).toHaveLength(0)
    })

    it('rejects invalid month-named date (40 aprile)', () => {
        const r = preParser.parseAbsoluteDate({ message: 'il 40 aprile 2026' })
        expect(r).toHaveLength(0)
    })

    it('matches 2-digit year in month-named format', () => {
        const r = preParser.parseAbsoluteDate({ message: 'data 20 apr 26' })
        expect(r).toHaveLength(1)
        expect(r[0].value).toBe('2026-04-20')
    })

    it('rejects invalid calendar date (month 13)', () => {
        const r = preParser.parseAbsoluteDate({ message: 'data 2026-13-01' })
        expect(r).toHaveLength(0)
    })

    it('rejects year too old (<1900)', () => {
        const r = preParser.parseAbsoluteDate({ message: 'data 1850-01-01' })
        expect(r).toHaveLength(0)
    })

    it('rejects year too far (>2100)', () => {
        const r = preParser.parseAbsoluteDate({ message: 'data 2150-01-01' })
        expect(r).toHaveLength(0)
    })

    it('does not double-match same span via both ISO and Italian parsers', () => {
        const r = preParser.parseAbsoluteDate({ message: '2026-04-15' })
        expect(r).toHaveLength(1)
    })
})

describe('preParser.parseReasonCodeWithCue', () => {
    it('matches "motivazione 01"', () => {
        const r = preParser.parseReasonCodeWithCue({ message: 'motivazione 01 trasferimento estero' })
        expect(r).toHaveLength(1)
        expect(r[0].value).toBe('01')
    })

    it('matches "codice 03"', () => {
        const r = preParser.parseReasonCodeWithCue({ message: 'codice 03' })
        expect(r).toHaveLength(1)
        expect(r[0].value).toBe('03')
    })

    it('matches "causale 05"', () => {
        const r = preParser.parseReasonCodeWithCue({ message: 'causale 05' })
        expect(r).toHaveLength(1)
        expect(r[0].value).toBe('05')
    })

    it('matches case-insensitive', () => {
        const r = preParser.parseReasonCodeWithCue({ message: 'MOTIVAZIONE 02' })
        expect(r).toHaveLength(1)
        expect(r[0].value).toBe('02')
    })

    it('does not match without cue', () => {
        const r = preParser.parseReasonCodeWithCue({ message: 'il 01 aprile' })
        expect(r).toHaveLength(0)
    })

    it('does not match wrong digit count', () => {
        const r = preParser.parseReasonCodeWithCue({ message: 'motivazione 001' })
        expect(r).toHaveLength(0)
    })
})

describe('preParser.parseConfirmationKeyword', () => {
    it('matches "sì confermo"', () => {
        const r = preParser.parseConfirmationKeyword({ message: 'sì confermo' })
        expect(r).not.toBeNull()
    })

    it('matches "confermo"', () => {
        const r = preParser.parseConfirmationKeyword({ message: 'confermo' })
        expect(r).not.toBeNull()
    })

    it('matches "procedi"', () => {
        const r = preParser.parseConfirmationKeyword({ message: 'procedi' })
        expect(r).not.toBeNull()
    })

    it('matches "va bene"', () => {
        const r = preParser.parseConfirmationKeyword({ message: 'va bene' })
        expect(r).not.toBeNull()
    })

    it('matches "ok" isolated', () => {
        const r = preParser.parseConfirmationKeyword({ message: 'ok' })
        expect(r).not.toBeNull()
    })

    it('matches "sì" isolated', () => {
        const r = preParser.parseConfirmationKeyword({ message: 'sì' })
        expect(r).not.toBeNull()
    })

    it('does not match "no"', () => {
        const r = preParser.parseConfirmationKeyword({ message: 'no' })
        expect(r).toBeNull()
    })

    it('does not match on arbitrary text', () => {
        const r = preParser.parseConfirmationKeyword({ message: 'vorrei estinguere' })
        expect(r).toBeNull()
    })
})

describe('preParser.run (end-to-end)', () => {
    it('extracts only the date, not 20 as reason code', () => {
        const r = preParser.run({ message: 'voglio estinguere il conto di bellafronte il 20 aprile 2026' })
        const fields = r.candidates.map(c => c.field)
        expect(fields).toContain('closureDate')
        expect(fields).not.toContain('closureReasonCode')
    })

    it('extracts rapportoId + date together', () => {
        const r = preParser.run({ message: 'rapporto 01-034-00392400 data 2026-04-15' })
        const fields = r.candidates.map(c => c.field).sort()
        expect(fields).toContain('closureDate')
        expect(fields).toContain('rapportoId')
    })

    it('does not extract NDG from year inside date', () => {
        const r = preParser.run({ message: '2026-04-15' })
        const fields = r.candidates.map(c => c.field)
        expect(fields).toContain('closureDate')
        expect(fields).not.toContain('ndg')
    })

    it('extracts reason code with cue + date in same message', () => {
        const r = preParser.run({ message: 'motivazione 01 trasferimento data 2026-04-15' })
        const fields = r.candidates.map(c => c.field).sort()
        expect(fields).toContain('closureReasonCode')
        expect(fields).toContain('closureDate')
    })

    it('returns empty candidates on irrelevant message', () => {
        const r = preParser.run({ message: 'ciao come stai' })
        expect(r.candidates).toHaveLength(0)
    })

    it('extracts standalone NDG (covers push path)', () => {
        const r = preParser.run({ message: 'NDG 11255521' })
        const ndgs = r.candidates.filter(c => c.field === 'ndg')
        expect(ndgs).toHaveLength(1)
        expect(ndgs[0].value).toBe('11255521')
    })

    it('skips NDG when its span overlaps reserved rapporto span', () => {
        const r = preParser.run({ message: 'rapporto 01-034-00392400' })
        const ndgs = r.candidates.filter(c => c.field === 'ndg')
        expect(ndgs).toHaveLength(0)
    })

    it('confirmation keyword added alongside date', () => {
        const r = preParser.run({ message: 'data 2026-04-15 procedi' })
        const fields = r.candidates.map(c => c.field)
        expect(fields).toContain('closureDate')
        expect(fields).toContain('turnAffirmed')
    })
})

describe('preParser.isValidCalendarDate', () => {
    it('accepts Jan 1', () => {
        expect(preParser.isValidCalendarDate({ year: 2026, month: 1, day: 1 })).toBe(true)
    })

    it('rejects Feb 30', () => {
        expect(preParser.isValidCalendarDate({ year: 2026, month: 2, day: 30 })).toBe(false)
    })

    it('accepts leap year Feb 29', () => {
        expect(preParser.isValidCalendarDate({ year: 2024, month: 2, day: 29 })).toBe(true)
    })

    it('rejects non-leap year Feb 29', () => {
        expect(preParser.isValidCalendarDate({ year: 2025, month: 2, day: 29 })).toBe(false)
    })

    it('rejects month 0', () => {
        expect(preParser.isValidCalendarDate({ year: 2026, month: 0, day: 1 })).toBe(false)
    })

    it('rejects day 0', () => {
        expect(preParser.isValidCalendarDate({ year: 2026, month: 1, day: 0 })).toBe(false)
    })
})
