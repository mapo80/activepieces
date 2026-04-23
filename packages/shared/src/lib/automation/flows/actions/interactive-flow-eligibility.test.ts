import { describe, expect, it } from 'vitest'
import { computeFieldEligibility } from './interactive-flow-eligibility'

describe('computeFieldEligibility — contract-only eligibility for the LLM extractor', () => {
    it('includes extractable:true fields without any parser (fixture-style customerName)', () => {
        const eligible = computeFieldEligibility({
            currentNode: { stateOutputs: ['customerMatches'] },
            stateFields: [
                { name: 'customerName', extractable: true },
                { name: 'customerMatches', extractable: false },
            ],
        })
        expect(eligible.has('customerName')).toBe(true)
        expect(eligible.has('customerMatches')).toBe(true) // via stateOutputs
    })

    it('includes extractable:true fields with any parser string (Copilot-style ner-name)', () => {
        const eligible = computeFieldEligibility({
            currentNode: { stateOutputs: ['customerMatches'] },
            stateFields: [
                { name: 'customerName', extractable: true, extractionScope: 'global' },
                { name: 'ndg', extractable: true },
            ],
        })
        expect(eligible.has('customerName')).toBe(true)
        expect(eligible.has('ndg')).toBe(true)
    })

    it('treats undefined extractionScope as global (default)', () => {
        const eligible = computeFieldEligibility({
            stateFields: [
                { name: 'fiscalCode', extractable: true },
            ],
        })
        expect(eligible.has('fiscalCode')).toBe(true)
    })

    it('excludes extractable:false catalog fields (unless explicitly in stateOutputs)', () => {
        const eligible = computeFieldEligibility({
            currentNode: { stateOutputs: [] },
            stateFields: [
                { name: 'customerMatches', extractable: false },
            ],
        })
        expect(eligible.has('customerMatches')).toBe(false)
    })

    it('excludes node-local fields globally (confirmed pattern)', () => {
        const eligible = computeFieldEligibility({
            currentNode: { stateOutputs: ['caseId'] },
            stateFields: [
                { name: 'confirmed', extractable: true, extractionScope: 'node-local' },
            ],
        })
        expect(eligible.has('confirmed')).toBe(false)
    })

    it('includes node-local fields when they are in currentNode.stateOutputs', () => {
        const eligible = computeFieldEligibility({
            currentNode: { stateOutputs: ['confirmed'] },
            stateFields: [
                { name: 'confirmed', extractable: true, extractionScope: 'node-local' },
            ],
        })
        expect(eligible.has('confirmed')).toBe(true)
    })

    it('includes identityFields always', () => {
        const eligible = computeFieldEligibility({
            identityFields: ['userId', 'tenantId'],
            stateFields: [],
        })
        expect(eligible.has('userId')).toBe(true)
        expect(eligible.has('tenantId')).toBe(true)
    })

    it('includes currentNode.allowedExtraFields (per-node opt-in)', () => {
        const eligible = computeFieldEligibility({
            currentNode: { stateOutputs: [], allowedExtraFields: ['overrideHint'] },
            stateFields: [],
        })
        expect(eligible.has('overrideHint')).toBe(true)
    })

    it('returns empty Set when nothing is eligible', () => {
        const eligible = computeFieldEligibility({
            stateFields: [
                { name: 'customerMatches', extractable: false },
                { name: 'confirmed', extractable: true, extractionScope: 'node-local' },
            ],
        })
        expect(eligible.size).toBe(0)
    })

    it('deduplicates names across sources (stateOutputs + extractable-global)', () => {
        const eligible = computeFieldEligibility({
            currentNode: { stateOutputs: ['ndg'] },
            stateFields: [
                { name: 'ndg', extractable: true, extractionScope: 'global' },
            ],
        })
        expect(eligible.size).toBe(1)
        expect(eligible.has('ndg')).toBe(true)
    })
})
