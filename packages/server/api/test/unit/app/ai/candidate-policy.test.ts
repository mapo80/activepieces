import { describe, expect, it } from 'vitest'
import { candidatePolicy } from '../../../../src/app/ai/candidate-policy'

describe('candidatePolicy.verifyEvidence', () => {
    it('rejects missing evidence', () => {
        const r = candidatePolicy.verifyEvidence({ evidence: undefined, userMessage: 'bellafronte' })
        expect(r.ok).toBe(false)
    })

    it('rejects empty evidence', () => {
        const r = candidatePolicy.verifyEvidence({ evidence: '', userMessage: 'bellafronte' })
        expect(r.ok).toBe(false)
    })

    it('rejects 1-char evidence', () => {
        const r = candidatePolicy.verifyEvidence({ evidence: 'a', userMessage: 'abcdef' })
        expect(r.ok).toBe(false)
    })

    it('accepts valid substring evidence', () => {
        const r = candidatePolicy.verifyEvidence({ evidence: 'bellafronte', userMessage: 'voglio chiudere bellafronte' })
        expect(r.ok).toBe(true)
    })

    it('accepts case-insensitive substring', () => {
        const r = candidatePolicy.verifyEvidence({ evidence: 'BELLAFRONTE', userMessage: 'cliente bellafronte' })
        expect(r.ok).toBe(true)
    })

    it('rejects non-substring evidence', () => {
        const r = candidatePolicy.verifyEvidence({ evidence: 'Rossi', userMessage: 'voglio Bellafronte' })
        expect(r.ok).toBe(false)
    })

    it('rejects paraphrase (synonym)', () => {
        const r = candidatePolicy.verifyEvidence({ evidence: 'arrabbiato', userMessage: 'sono irritato' })
        expect(r.ok).toBe(false)
    })

    it('accepts diacritic-insensitive match', () => {
        const r = candidatePolicy.verifyEvidence({ evidence: 'perche', userMessage: 'sono Perché' })
        expect(r.ok).toBe(true)
    })
})

describe('candidatePolicy.verifyFieldPlausibility — customerName', () => {
    it('accepts "Bellafronte"', () => {
        const r = candidatePolicy.verifyFieldPlausibility({ field: 'customerName', value: 'Bellafronte' })
        expect(r.ok).toBe(true)
    })

    it('accepts "Mario Rossi"', () => {
        const r = candidatePolicy.verifyFieldPlausibility({ field: 'customerName', value: 'Mario Rossi' })
        expect(r.ok).toBe(true)
    })

    it("accepts \"D'Angelo\"", () => {
        const r = candidatePolicy.verifyFieldPlausibility({ field: 'customerName', value: "D'Angelo" })
        expect(r.ok).toBe(true)
    })

    it('accepts hyphenated "De-Martini"', () => {
        const r = candidatePolicy.verifyFieldPlausibility({ field: 'customerName', value: 'De-Martini' })
        expect(r.ok).toBe(true)
    })

    it('rejects "ciao" (conversational)', () => {
        const r = candidatePolicy.verifyFieldPlausibility({ field: 'customerName', value: 'ciao' })
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.reason).toMatch(/blocklisted/)
    })

    it('rejects "procedere" (verb)', () => {
        const r = candidatePolicy.verifyFieldPlausibility({ field: 'customerName', value: 'procedere' })
        expect(r.ok).toBe(false)
    })

    it('rejects "rapporti" (domain word)', () => {
        const r = candidatePolicy.verifyFieldPlausibility({ field: 'customerName', value: 'rapporti' })
        expect(r.ok).toBe(false)
    })

    it('rejects digits', () => {
        const r = candidatePolicy.verifyFieldPlausibility({ field: 'customerName', value: 'Mario123' })
        expect(r.ok).toBe(false)
    })

    it('rejects empty', () => {
        const r = candidatePolicy.verifyFieldPlausibility({ field: 'customerName', value: '' })
        expect(r.ok).toBe(false)
    })

    it('rejects single char', () => {
        const r = candidatePolicy.verifyFieldPlausibility({ field: 'customerName', value: 'A' })
        expect(r.ok).toBe(false)
    })

    it('rejects 5+ tokens', () => {
        const r = candidatePolicy.verifyFieldPlausibility({ field: 'customerName', value: 'Un Nome Troppo Lungo Qui' })
        expect(r.ok).toBe(false)
    })

    it('rejects null value', () => {
        const r = candidatePolicy.verifyFieldPlausibility({ field: 'customerName', value: null })
        expect(r.ok).toBe(false)
    })

    it('rejects non-string value', () => {
        const r = candidatePolicy.verifyFieldPlausibility({ field: 'customerName', value: 123 })
        expect(r.ok).toBe(false)
    })
})

describe('candidatePolicy.verifyFieldPlausibility — generic rules', () => {
    it('accepts value meeting minLength', () => {
        const r = candidatePolicy.verifyFieldPlausibility({ field: 'x', value: '12345678', rules: { minLength: 6 } })
        expect(r.ok).toBe(true)
    })

    it('rejects value below minLength', () => {
        const r = candidatePolicy.verifyFieldPlausibility({ field: 'x', value: 'abc', rules: { minLength: 6 } })
        expect(r.ok).toBe(false)
    })

    it('rejects value above maxLength', () => {
        const r = candidatePolicy.verifyFieldPlausibility({ field: 'x', value: 'abcdefghij', rules: { maxLength: 5 } })
        expect(r.ok).toBe(false)
    })

    it('accepts value matching pattern', () => {
        const r = candidatePolicy.verifyFieldPlausibility({ field: 'x', value: '12345678', rules: { pattern: '^\\d+$' } })
        expect(r.ok).toBe(true)
    })

    it('rejects value violating pattern', () => {
        const r = candidatePolicy.verifyFieldPlausibility({ field: 'x', value: 'abc', rules: { pattern: '^\\d+$' } })
        expect(r.ok).toBe(false)
    })
})

describe('candidatePolicy.verifyDomain — closureDate', () => {
    it('accepts future date within 5 years', () => {
        const future = new Date()
        future.setFullYear(future.getFullYear() + 1)
        const isoDate = future.toISOString().slice(0, 10)
        const r = candidatePolicy.verifyDomain({ field: 'closureDate', value: isoDate, state: {} })
        expect(r.ok).toBe(true)
    })

    it('rejects date in past', () => {
        const r = candidatePolicy.verifyDomain({ field: 'closureDate', value: '2020-01-01', state: {} })
        expect(r.ok).toBe(false)
    })

    it('rejects date too far in future', () => {
        const r = candidatePolicy.verifyDomain({ field: 'closureDate', value: '2099-01-01', state: {} })
        expect(r.ok).toBe(false)
    })

    it('rejects unparseable date', () => {
        const r = candidatePolicy.verifyDomain({ field: 'closureDate', value: 'not-a-date', state: {} })
        expect(r.ok).toBe(false)
    })

    it('rejects non-string date', () => {
        const r = candidatePolicy.verifyDomain({ field: 'closureDate', value: 42, state: {} })
        expect(r.ok).toBe(false)
    })
})

describe('candidatePolicy.verifyDomain — enumFrom', () => {
    const state = {
        closureReasons: [
            { codice: '01', descr: 'Trasferimento' },
            { codice: '02', descr: 'Trasloco' },
            { codice: '03', descr: 'Decesso' },
        ],
    }
    const spec = { enumFrom: 'closureReasons', enumValueField: 'codice' }

    it('accepts value in enum state', () => {
        const r = candidatePolicy.verifyDomain({ field: 'closureReasonCode', value: '01', state, fieldSpec: spec })
        expect(r.ok).toBe(true)
    })

    it('rejects value NOT in enum state', () => {
        const r = candidatePolicy.verifyDomain({ field: 'closureReasonCode', value: '20', state, fieldSpec: spec })
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.reason).toContain('not-in-state')
    })

    it('rejects when enumFrom state is empty/undefined', () => {
        const r = candidatePolicy.verifyDomain({ field: 'closureReasonCode', value: '01', state: {}, fieldSpec: spec })
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.reason).toContain('unavailable')
    })

    it('accepts any value when no fieldSpec (unconstrained)', () => {
        const r = candidatePolicy.verifyDomain({ field: 'customerName', value: 'Bellafronte', state })
        expect(r.ok).toBe(true)
    })
})

describe('candidatePolicy.verifyFieldAdmissibility', () => {
    it('always accepts turnAffirmed', () => {
        const r = candidatePolicy.verifyFieldAdmissibility({
            field: 'turnAffirmed',
            currentNode: { nodeId: 'x' },
        })
        expect(r.ok).toBe(true)
    })

    it('accepts field listed in currentNode.stateOutputs', () => {
        const r = candidatePolicy.verifyFieldAdmissibility({
            field: 'ndg',
            currentNode: { nodeId: 'pick_ndg', stateOutputs: ['ndg'] },
        })
        expect(r.ok).toBe(true)
    })

    it('accepts identity field even if not in current node outputs', () => {
        const r = candidatePolicy.verifyFieldAdmissibility({
            field: 'customerName',
            currentNode: { nodeId: 'pick_rapporto', stateOutputs: ['rapportoId'] },
            identityFields: ['customerName'],
        })
        expect(r.ok).toBe(true)
    })

    it('accepts allowedExtraFields', () => {
        const r = candidatePolicy.verifyFieldAdmissibility({
            field: 'closureDate',
            currentNode: { nodeId: 'collect_reason', stateOutputs: ['closureReasonCode'], allowedExtraFields: ['closureDate'] },
        })
        expect(r.ok).toBe(true)
    })

    it('rejects field not admissible at currentNode', () => {
        const r = candidatePolicy.verifyFieldAdmissibility({
            field: 'closureDate',
            currentNode: { nodeId: 'pick_ndg', stateOutputs: ['ndg'] },
        })
        expect(r.ok).toBe(false)
    })
})

describe('candidatePolicy.verifyFieldAdmissibility — extractionScope', () => {
    it('admits extractable data field at ANY node when extractionScope is undefined (default global)', () => {
        const r = candidatePolicy.verifyFieldAdmissibility({
            field: 'closureDate',
            currentNode: { nodeId: 'pick_ndg', stateOutputs: ['ndg'] },
            fieldSpec: { extractable: true },
        })
        expect(r.ok).toBe(true)
    })
    it('admits extractable data field at ANY node when extractionScope=global explicit', () => {
        const r = candidatePolicy.verifyFieldAdmissibility({
            field: 'closureDate',
            currentNode: { nodeId: 'pick_ndg', stateOutputs: ['ndg'] },
            fieldSpec: { extractable: true, extractionScope: 'global' },
        })
        expect(r.ok).toBe(true)
    })
    it('admits node-local field ONLY when in currentNode.stateOutputs', () => {
        const r = candidatePolicy.verifyFieldAdmissibility({
            field: 'confirmed',
            currentNode: { nodeId: 'confirm_closure', stateOutputs: ['confirmed'] },
            fieldSpec: { extractable: true, extractionScope: 'node-local' },
        })
        expect(r.ok).toBe(true)
    })
    it('admits node-local field when in currentNode.allowedExtraFields', () => {
        const r = candidatePolicy.verifyFieldAdmissibility({
            field: 'confirmed',
            currentNode: { nodeId: 'x', stateOutputs: ['y'], allowedExtraFields: ['confirmed'] },
            fieldSpec: { extractable: true, extractionScope: 'node-local' },
        })
        expect(r.ok).toBe(true)
    })
    it('rejects node-local field outside both stateOutputs and allowedExtraFields', () => {
        const r = candidatePolicy.verifyFieldAdmissibility({
            field: 'confirmed',
            currentNode: { nodeId: 'pick_ndg', stateOutputs: ['ndg'] },
            fieldSpec: { extractable: true, extractionScope: 'node-local' },
        })
        expect(r.ok).toBe(false)
    })
    it('falls back to node-local path when fieldSpec.extractable is not true', () => {
        const r = candidatePolicy.verifyFieldAdmissibility({
            field: 'profile',
            currentNode: { nodeId: 'pick_ndg', stateOutputs: ['ndg'] },
            fieldSpec: { extractable: false },
        })
        expect(r.ok).toBe(false)
    })
})
