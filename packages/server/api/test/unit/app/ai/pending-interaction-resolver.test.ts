import { describe, expect, it } from 'vitest'
import { pendingInteractionResolver, PendingInteraction } from '../../../../src/app/ai/pending-interaction-resolver'

describe('pendingInteractionResolver.parseOrdinal', () => {
    it('parses "il primo"', () => {
        expect(pendingInteractionResolver.parseOrdinal({ message: 'il primo' })).toBe(1)
    })

    it('parses "il secondo"', () => {
        expect(pendingInteractionResolver.parseOrdinal({ message: 'il secondo' })).toBe(2)
    })

    it('parses "il terzo"', () => {
        expect(pendingInteractionResolver.parseOrdinal({ message: 'il terzo' })).toBe(3)
    })

    it('parses "il quarto"', () => {
        expect(pendingInteractionResolver.parseOrdinal({ message: 'il quarto' })).toBe(4)
    })

    it('parses "il quinto"', () => {
        expect(pendingInteractionResolver.parseOrdinal({ message: 'il quinto' })).toBe(5)
    })

    it('parses "la prima" (feminine)', () => {
        expect(pendingInteractionResolver.parseOrdinal({ message: 'la prima' })).toBe(1)
    })

    it('parses "ultimo" as -1', () => {
        expect(pendingInteractionResolver.parseOrdinal({ message: "l'ultimo" })).toBe(-1)
    })

    it('parses "ultima" as -1', () => {
        expect(pendingInteractionResolver.parseOrdinal({ message: "l'ultima" })).toBe(-1)
    })

    it('parses "il 2"', () => {
        expect(pendingInteractionResolver.parseOrdinal({ message: 'il 2' })).toBe(2)
    })

    it('parses "#3"', () => {
        expect(pendingInteractionResolver.parseOrdinal({ message: '#3' })).toBe(3)
    })

    it('parses naked digit "7"', () => {
        expect(pendingInteractionResolver.parseOrdinal({ message: '7' })).toBe(7)
    })

    it('returns null for irrelevant message', () => {
        expect(pendingInteractionResolver.parseOrdinal({ message: 'bellafronte' })).toBeNull()
    })

    it('returns null for empty message', () => {
        expect(pendingInteractionResolver.parseOrdinal({ message: '' })).toBeNull()
    })

    it('does not confuse "ottavo" (8) with "otto" (just number)', () => {
        expect(pendingInteractionResolver.parseOrdinal({ message: "l'ottavo" })).toBe(8)
    })
})

describe('pendingInteractionResolver.resolve — confirm_binary', () => {
    const pending: PendingInteraction = {
        type: 'confirm_binary',
        field: 'ndg',
        target: '11255521',
        nodeId: 'pick_ndg',
    }

    it('accepts "sì"', () => {
        const r = pendingInteractionResolver.resolve({ message: 'sì', pending })
        expect(r.outcome).toBe('accept')
        if (r.outcome === 'accept') {
            expect(r.value).toBe('11255521')
            expect(r.field).toBe('ndg')
        }
    })

    it('accepts "confermo"', () => {
        const r = pendingInteractionResolver.resolve({ message: 'confermo', pending })
        expect(r.outcome).toBe('accept')
    })

    it('accepts "ok procedi"', () => {
        const r = pendingInteractionResolver.resolve({ message: 'ok procedi', pending })
        expect(r.outcome).toBe('accept')
    })

    it('rejects on "no"', () => {
        const r = pendingInteractionResolver.resolve({ message: 'no', pending })
        expect(r.outcome).toBe('reject')
    })

    it('rejects on "annulla"', () => {
        const r = pendingInteractionResolver.resolve({ message: 'annulla', pending })
        expect(r.outcome).toBe('reject')
    })

    it('rejects on "non era"', () => {
        const r = pendingInteractionResolver.resolve({ message: 'non era quello', pending })
        expect(r.outcome).toBe('reject')
    })

    it('no-match on irrelevant', () => {
        const r = pendingInteractionResolver.resolve({ message: 'voglio cambiare cliente', pending })
        expect(r.outcome).toBe('no-match')
    })
})

describe('pendingInteractionResolver.resolve — pick_from_list', () => {
    const pending: PendingInteraction = {
        type: 'pick_from_list',
        field: 'ndg',
        options: [
            { ordinal: 1, label: 'BELLAFRONTE GIANLUCA', value: '11255521' },
            { ordinal: 2, label: 'ROSSI MARIO', value: '22334455' },
            { ordinal: 3, label: 'VERDI ANNA', value: '33445566' },
        ],
        nodeId: 'pick_ndg',
    }

    it('resolves "il secondo" to options[1].value', () => {
        const r = pendingInteractionResolver.resolve({ message: 'il secondo', pending })
        expect(r.outcome).toBe('accept')
        if (r.outcome === 'accept') {
            expect(r.value).toBe('22334455')
        }
    })

    it('resolves "il primo"', () => {
        const r = pendingInteractionResolver.resolve({ message: 'il primo', pending })
        expect(r.outcome).toBe('accept')
        if (r.outcome === 'accept') expect(r.value).toBe('11255521')
    })

    it('resolves "l\'ultimo"', () => {
        const r = pendingInteractionResolver.resolve({ message: "l'ultimo", pending })
        expect(r.outcome).toBe('accept')
        if (r.outcome === 'accept') expect(r.value).toBe('33445566')
    })

    it('resolves numeric "il 2"', () => {
        const r = pendingInteractionResolver.resolve({ message: 'il 2', pending })
        expect(r.outcome).toBe('accept')
        if (r.outcome === 'accept') expect(r.value).toBe('22334455')
    })

    it('resolves label substring "BELLAFRONTE"', () => {
        const r = pendingInteractionResolver.resolve({ message: 'scelgo BELLAFRONTE', pending })
        expect(r.outcome).toBe('accept')
        if (r.outcome === 'accept') expect(r.value).toBe('11255521')
    })

    it('out-of-range ordinal', () => {
        const r = pendingInteractionResolver.resolve({ message: 'il 99', pending })
        expect(r.outcome).toBe('out-of-range')
    })

    it('no-match on unrelated label', () => {
        const r = pendingInteractionResolver.resolve({ message: 'SCONOSCIUTO', pending })
        expect(r.outcome).toBe('no-match')
    })

    it('empty options list → out-of-range or no-match', () => {
        const emptyPending: PendingInteraction = {
            type: 'pick_from_list',
            field: 'ndg',
            options: [],
            nodeId: 'x',
        }
        const r = pendingInteractionResolver.resolve({ message: 'il primo', pending: emptyPending })
        expect(r.outcome === 'out-of-range' || r.outcome === 'no-match').toBe(true)
    })
})

describe('pendingInteractionResolver.resolve — pending_overwrite', () => {
    const pending: PendingInteraction = {
        type: 'pending_overwrite',
        field: 'customerName',
        oldValue: 'Bellafronte',
        newValue: 'Rossi',
        nodeId: 'x',
    }

    it('accepts on "sì"', () => {
        const r = pendingInteractionResolver.resolve({ message: 'sì', pending })
        expect(r.outcome).toBe('accept')
        if (r.outcome === 'accept') expect(r.value).toBe('Rossi')
    })

    it('rejects on "no"', () => {
        const r = pendingInteractionResolver.resolve({ message: 'no', pending })
        expect(r.outcome).toBe('reject')
    })

    it('no-match on neutral message', () => {
        const r = pendingInteractionResolver.resolve({ message: 'dimmi altro', pending })
        expect(r.outcome).toBe('no-match')
    })
})

describe('pendingInteractionResolver.resolve — open_text', () => {
    const pending: PendingInteraction = {
        type: 'open_text',
        field: 'customerName',
        nodeId: 'x',
    }

    it('always no-match (LLM should handle open_text)', () => {
        const r = pendingInteractionResolver.resolve({ message: 'Bellafronte', pending })
        expect(r.outcome).toBe('no-match')
    })
})
