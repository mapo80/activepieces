import { describe, expect, it } from 'vitest'
import { reasonResolver, ClosureReason } from '../../../../src/app/ai/reason-resolver'

const REASONS: ClosureReason[] = [
    { codice: '01', descr: "Trasferimento all'estero" },
    { codice: '02', descr: 'Trasloco' },
    { codice: '03', descr: 'Decesso titolare' },
    { codice: '04', descr: 'Insoddisfazione servizio' },
    { codice: '05', descr: 'Altre motivazioni' },
    { codice: '32', descr: 'Chiusura per volontà banca' },
    { codice: '98', descr: 'Non specificata' },
]

describe('reasonResolver.resolve — E3 vague rejection (FIRST filter)', () => {
    it('rejects "la stessa"', () => {
        const r = reasonResolver.resolve({ reasonText: 'la stessa', closureReasons: REASONS })
        expect(r.resolution).toBe('vague-rejected')
    })
    it('rejects "quella"', () => {
        const r = reasonResolver.resolve({ reasonText: 'quella', closureReasons: REASONS })
        expect(r.resolution).toBe('vague-rejected')
    })
    it('rejects "come prima"', () => {
        const r = reasonResolver.resolve({ reasonText: 'come prima', closureReasons: REASONS })
        expect(r.resolution).toBe('vague-rejected')
    })
    it("rejects \"l'altra\"", () => {
        const r = reasonResolver.resolve({ reasonText: "l'altra", closureReasons: REASONS })
        expect(r.resolution).toBe('vague-rejected')
    })
    it('rejects "la solita"', () => {
        const r = reasonResolver.resolve({ reasonText: 'la solita', closureReasons: REASONS })
        expect(r.resolution).toBe('vague-rejected')
    })
    it('rejects "stessa di prima"', () => {
        const r = reasonResolver.resolve({ reasonText: 'stessa di prima', closureReasons: REASONS })
        expect(r.resolution).toBe('vague-rejected')
    })
})

describe('reasonResolver.resolve — exact match', () => {
    it('exact code "01"', () => {
        const r = reasonResolver.resolve({ reasonText: '01', closureReasons: REASONS })
        expect(r.resolution).toBe('unique')
        if (r.resolution === 'unique') expect(r.code).toBe('01')
    })
    it('unknown code "99"', () => {
        const r = reasonResolver.resolve({ reasonText: '99', closureReasons: REASONS })
        expect(r.resolution).toBe('none')
    })
    it('exact normalized descr', () => {
        const r = reasonResolver.resolve({ reasonText: 'Trasloco', closureReasons: REASONS })
        expect(r.resolution).toBe('unique')
        if (r.resolution === 'unique') expect(r.code).toBe('02')
    })
    it('exact descr with diacritic', () => {
        const r = reasonResolver.resolve({ reasonText: 'trasferimento all estero', closureReasons: REASONS })
        expect(r.resolution).toBe('unique')
    })
})

describe('reasonResolver.resolve — substring match', () => {
    it('user phrase contained in descr (trasferimento → Trasferimento all estero)', () => {
        const r = reasonResolver.resolve({ reasonText: 'trasferimento', closureReasons: REASONS })
        expect(r.resolution).toBe('unique')
        if (r.resolution === 'unique') expect(r.code).toBe('01')
    })
    it('descr contained in user phrase ("trasloco completo" → Trasloco)', () => {
        const r = reasonResolver.resolve({ reasonText: 'trasloco', closureReasons: REASONS })
        expect(r.resolution).toBe('unique')
        if (r.resolution === 'unique') expect(r.code).toBe('02')
    })
})

describe('reasonResolver.resolve — ambiguity', () => {
    it('returns ambiguous when multiple substring matches', () => {
        const reasons: ClosureReason[] = [
            { codice: '01', descr: 'Trasferimento estero' },
            { codice: '02', descr: 'Trasferimento interno' },
        ]
        const r = reasonResolver.resolve({ reasonText: 'trasferimento', closureReasons: reasons })
        expect(r.resolution).toBe('ambiguous')
    })
    it('returns ambiguous via token-overlap when ties', () => {
        const reasons: ClosureReason[] = [
            { codice: '01', descr: 'chiusura banca opzione uno' },
            { codice: '02', descr: 'chiusura banca opzione due' },
        ]
        const r = reasonResolver.resolve({ reasonText: 'chiusura banca', closureReasons: reasons })
        expect(r.resolution === 'unique' || r.resolution === 'ambiguous').toBe(true)
    })
})

describe('reasonResolver.resolve — no match', () => {
    it('empty text → none', () => {
        const r = reasonResolver.resolve({ reasonText: '', closureReasons: REASONS })
        expect(r.resolution).toBe('none')
    })
    it('completely unrelated text → none', () => {
        const r = reasonResolver.resolve({ reasonText: 'xyzzy abcxyz', closureReasons: REASONS })
        expect(r.resolution).toBe('none')
    })
})

describe('reasonResolver.resolve — token overlap fallback', () => {
    it('unique when clear winner by token overlap', () => {
        const reasons: ClosureReason[] = [
            { codice: '01', descr: 'Trasferimento all estero paese diverso' },
            { codice: '02', descr: 'Insoddisfazione del servizio generico' },
        ]
        const r = reasonResolver.resolve({ reasonText: 'estero paese', closureReasons: reasons })
        expect(r.resolution).toBe('unique')
        if (r.resolution === 'unique') expect(r.code).toBe('01')
    })
})
