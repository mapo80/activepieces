import { describe, expect, it } from 'vitest'
import { overwritePolicy } from '../../../../src/app/ai/overwrite-policy'

describe('overwritePolicy.detectCueOfCorrection', () => {
    it('detects "scusa"', () => {
        expect(overwritePolicy.detectCueOfCorrection({ message: 'scusa, cercavo Rossi' }).present).toBe(true)
    })
    it('detects "invece"', () => {
        expect(overwritePolicy.detectCueOfCorrection({ message: 'invece era Rossi' }).present).toBe(true)
    })
    it('detects "anzi"', () => {
        expect(overwritePolicy.detectCueOfCorrection({ message: 'anzi Rossi' }).present).toBe(true)
    })
    it('detects "cercavo"', () => {
        expect(overwritePolicy.detectCueOfCorrection({ message: 'cercavo Rossi' }).present).toBe(true)
    })
    it('detects "volevo"', () => {
        expect(overwritePolicy.detectCueOfCorrection({ message: 'volevo Rossi' }).present).toBe(true)
    })
    it('detects "in effetti"', () => {
        expect(overwritePolicy.detectCueOfCorrection({ message: 'in effetti era Rossi' }).present).toBe(true)
    })
    it('detects "non era"', () => {
        expect(overwritePolicy.detectCueOfCorrection({ message: 'non era Rossi' }).present).toBe(true)
    })
    it('detects "piuttosto"', () => {
        expect(overwritePolicy.detectCueOfCorrection({ message: 'piuttosto Rossi' }).present).toBe(true)
    })
    it('detects "sorry" (en)', () => {
        expect(overwritePolicy.detectCueOfCorrection({ message: 'sorry I meant Rossi' }).present).toBe(true)
    })
    it('detects "actually"', () => {
        expect(overwritePolicy.detectCueOfCorrection({ message: 'actually Rossi' }).present).toBe(true)
    })
    it('detects "instead"', () => {
        expect(overwritePolicy.detectCueOfCorrection({ message: 'Rossi instead' }).present).toBe(true)
    })
    it('does NOT detect bare "no"', () => {
        expect(overwritePolicy.detectCueOfCorrection({ message: 'no capisco ripeti' }).present).toBe(false)
    })
    it('does NOT detect "nope"', () => {
        expect(overwritePolicy.detectCueOfCorrection({ message: 'nope' }).present).toBe(false)
    })
    it('returns cue text on match', () => {
        const r = overwritePolicy.detectCueOfCorrection({ message: 'scusa Rossi' })
        expect(r.present).toBe(true)
        if (r.present) expect(r.cue).toBe('scusa')
    })
    it('does NOT false-positive on "non capisco"', () => {
        expect(overwritePolicy.detectCueOfCorrection({ message: 'non capisco' }).present).toBe(false)
    })
})

describe('overwritePolicy.decideOverwrite', () => {
    it('accepts first-fill on empty old value (null)', () => {
        const r = overwritePolicy.decideOverwrite({
            field: 'customerName', oldValue: null, newValue: 'Bellafronte',
            cuePresent: false, plausible: true,
        })
        expect(r.action).toBe('accept')
    })

    it('accepts first-fill on undefined', () => {
        const r = overwritePolicy.decideOverwrite({
            field: 'customerName', oldValue: undefined, newValue: 'Bellafronte',
            cuePresent: false, plausible: true,
        })
        expect(r.action).toBe('accept')
    })

    it('accepts first-fill on empty string', () => {
        const r = overwritePolicy.decideOverwrite({
            field: 'customerName', oldValue: '', newValue: 'Bellafronte',
            cuePresent: false, plausible: true,
        })
        expect(r.action).toBe('accept')
    })

    it('accepts no-op when same value', () => {
        const r = overwritePolicy.decideOverwrite({
            field: 'customerName', oldValue: 'Bellafronte', newValue: 'Bellafronte',
            cuePresent: false, plausible: true,
        })
        expect(r.action).toBe('accept')
        if (r.action === 'accept') expect(r.reason).toBe('no-op')
    })

    it('accepts no-op with case-insensitive same value', () => {
        const r = overwritePolicy.decideOverwrite({
            field: 'customerName', oldValue: 'Bellafronte', newValue: 'BELLAFRONTE',
            cuePresent: false, plausible: true,
        })
        expect(r.action).toBe('accept')
    })

    it('rejects when new value not plausible (no cue)', () => {
        const r = overwritePolicy.decideOverwrite({
            field: 'customerName', oldValue: 'Bellafronte', newValue: 'procedere',
            cuePresent: false, plausible: false,
        })
        expect(r.action).toBe('reject')
    })

    it('accepts overwrite when cue present', () => {
        const r = overwritePolicy.decideOverwrite({
            field: 'customerName', oldValue: 'Bellafronte', newValue: 'Rossi',
            cuePresent: true, plausible: true,
        })
        expect(r.action).toBe('accept')
        if (r.action === 'accept') expect(r.reason).toBe('correction-cue')
    })

    it('confirms overwrite when plausible but no cue (pendingOverwrite)', () => {
        const r = overwritePolicy.decideOverwrite({
            field: 'customerName', oldValue: 'Bellafronte', newValue: 'Rossi',
            cuePresent: false, plausible: true,
        })
        expect(r.action).toBe('confirm')
        if (r.action === 'confirm') {
            expect(r.pendingOverwrite.field).toBe('customerName')
            expect(r.pendingOverwrite.oldValue).toBe('Bellafronte')
            expect(r.pendingOverwrite.newValue).toBe('Rossi')
        }
    })

    it('accepts empty array as empty state', () => {
        const r = overwritePolicy.decideOverwrite({
            field: 'customerMatches', oldValue: [], newValue: [{ x: 1 }],
            cuePresent: false, plausible: true,
        })
        expect(r.action).toBe('accept')
    })
})

describe('overwritePolicy.isEmpty', () => {
    it('returns true for null', () => expect(overwritePolicy.isEmpty(null)).toBe(true))
    it('returns true for undefined', () => expect(overwritePolicy.isEmpty(undefined)).toBe(true))
    it('returns true for empty string', () => expect(overwritePolicy.isEmpty('')).toBe(true))
    it('returns true for whitespace string', () => expect(overwritePolicy.isEmpty('   ')).toBe(true))
    it('returns true for empty array', () => expect(overwritePolicy.isEmpty([])).toBe(true))
    it('returns false for "0"', () => expect(overwritePolicy.isEmpty('0')).toBe(false))
    it('returns false for number 0', () => expect(overwritePolicy.isEmpty(0)).toBe(false))
    it('returns false for false', () => expect(overwritePolicy.isEmpty(false)).toBe(false))
    it('returns false for non-empty object', () => expect(overwritePolicy.isEmpty({ a: 1 })).toBe(false))
})

describe('overwritePolicy.valuesEqual', () => {
    it('equal primitives', () => expect(overwritePolicy.valuesEqual({ a: 1, b: 1 })).toBe(true))
    it('different primitives', () => expect(overwritePolicy.valuesEqual({ a: 1, b: 2 })).toBe(false))
    it('strings case-normalized', () => {
        expect(overwritePolicy.valuesEqual({ a: 'Bellafronte', b: 'BELLAFRONTE' })).toBe(true)
        expect(overwritePolicy.valuesEqual({ a: 'Bellafronte', b: 'Rossi' })).toBe(false)
    })
    it('objects deep-equal via JSON', () => {
        expect(overwritePolicy.valuesEqual({ a: { x: 1 }, b: { x: 1 } })).toBe(true)
        expect(overwritePolicy.valuesEqual({ a: { x: 1 }, b: { x: 2 } })).toBe(false)
    })
    it('circular refs handled gracefully', () => {
        const circular: { self?: unknown } = {}
        circular.self = circular
        expect(overwritePolicy.valuesEqual({ a: circular, b: circular })).toBe(true)
    })
})

describe('overwritePolicy.shouldPromoteTurnAffirmed', () => {
    it('does NOT promote in CONFIRM node without pending interaction (safety)', () => {
        expect(overwritePolicy.shouldPromoteTurnAffirmed({ currentNodeType: 'CONFIRM', pendingOverwriteActive: false })).toBe(false)
    })
    it('promotes when pendingOverwrite active (confirm_binary or pending_overwrite)', () => {
        expect(overwritePolicy.shouldPromoteTurnAffirmed({ currentNodeType: 'USER_INPUT', pendingOverwriteActive: true })).toBe(true)
    })
    it('promotes in CONFIRM node only when a pending interaction is active', () => {
        expect(overwritePolicy.shouldPromoteTurnAffirmed({ currentNodeType: 'CONFIRM', pendingOverwriteActive: true })).toBe(true)
    })
    it('does NOT promote in USER_INPUT without pending', () => {
        expect(overwritePolicy.shouldPromoteTurnAffirmed({ currentNodeType: 'USER_INPUT', pendingOverwriteActive: false })).toBe(false)
    })
    it('does NOT promote in TOOL', () => {
        expect(overwritePolicy.shouldPromoteTurnAffirmed({ currentNodeType: 'TOOL', pendingOverwriteActive: false })).toBe(false)
    })
    it('does NOT promote when currentNodeType undefined', () => {
        expect(overwritePolicy.shouldPromoteTurnAffirmed({ currentNodeType: undefined, pendingOverwriteActive: false })).toBe(false)
    })
})
