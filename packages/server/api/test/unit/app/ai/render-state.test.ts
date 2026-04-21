import { describe, expect, it } from 'vitest'
import { renderState } from '../../../../src/app/ai/render-state'

describe('renderState.renderMarkdownTable', () => {
    const columns = [
        { key: '_idx', header: '#' },
        { key: 'nome', header: 'Nome' },
        { key: 'ndg', header: 'NDG' },
    ]

    it('renders basic table with header + separator + rows', () => {
        const md = renderState.renderMarkdownTable({
            rows: [{ nome: 'BELLAFRONTE', ndg: '11255521' }],
            columns,
        })
        expect(md).toContain('| # | Nome | NDG |')
        expect(md).toContain('|---|---|---|')
        expect(md).toContain('| 1 | BELLAFRONTE | 11255521 |')
    })

    it('renders multi-row table with sequential index', () => {
        const md = renderState.renderMarkdownTable({
            rows: [
                { nome: 'ROSSI', ndg: '111' },
                { nome: 'VERDI', ndg: '222' },
            ],
            columns,
        })
        expect(md).toContain('| 1 | ROSSI | 111 |')
        expect(md).toContain('| 2 | VERDI | 222 |')
    })

    it('truncates beyond maxRows with overflow notice', () => {
        const rows = Array.from({ length: 15 }, (_, i) => ({ nome: `R${i}`, ndg: String(i) }))
        const md = renderState.renderMarkdownTable({ rows, columns, maxRows: 5 })
        expect(md.split('\n').filter(l => l.startsWith('| 1')).length).toBe(1)
        expect(md).toContain('altri 10 elementi')
    })

    it('custom overflow text used when provided', () => {
        const rows = Array.from({ length: 10 }, (_, i) => ({ nome: `R${i}`, ndg: String(i) }))
        const md = renderState.renderMarkdownTable({ rows, columns, maxRows: 3, overflowText: 'customText' })
        expect(md).toContain('customText')
    })

    it('renders placeholder for empty rows', () => {
        const md = renderState.renderMarkdownTable({ rows: [], columns })
        expect(md).toContain('nessun elemento')
    })

    it('applies eur format to saldo column', () => {
        const md = renderState.renderMarkdownTable({
            rows: [{ saldo: 1234.56 }],
            columns: [{ key: 'saldo', header: 'Saldo', format: 'eur' }],
        })
        expect(md).toContain('€')
        expect(md).toMatch(/1[.,]?234[,.]56/)
    })

    it('applies date format (DD/MM/YYYY)', () => {
        const md = renderState.renderMarkdownTable({
            rows: [{ data: '2026-04-15' }],
            columns: [{ key: 'data', header: 'Data', format: 'date' }],
        })
        expect(md).toContain('15/04/2026')
    })

    it('applies uppercase format', () => {
        const md = renderState.renderMarkdownTable({
            rows: [{ nome: 'bellafronte' }],
            columns: [{ key: 'nome', header: 'Nome', format: 'uppercase' }],
        })
        expect(md).toContain('BELLAFRONTE')
    })
})

describe('renderState.renderBulletList', () => {
    it('renders items with label+value', () => {
        const md = renderState.renderBulletList({
            items: [
                { label: '01', value: 'Trasferimento' },
                { label: '02', value: 'Trasloco' },
            ],
        })
        expect(md).toContain('- **01** — `Trasferimento`')
        expect(md).toContain('- **02** — `Trasloco`')
    })

    it('renders items with description', () => {
        const md = renderState.renderBulletList({
            items: [{ label: 'A', description: 'prima opzione' }],
        })
        expect(md).toContain('- **A** — prima opzione')
    })

    it('supports custom formatter', () => {
        const md = renderState.renderBulletList({
            items: [{ label: 'X' }],
            format: i => `[${i.label}]`,
        })
        expect(md).toContain('- [X]')
    })

    it('renders placeholder for empty list', () => {
        const md = renderState.renderBulletList({ items: [] })
        expect(md).toContain('nessun elemento')
    })

    it('renders label-only when no value', () => {
        const md = renderState.renderBulletList({ items: [{ label: 'solo label' }] })
        expect(md).toContain('- solo label')
    })
})

describe('renderState.renderConfirmSummary', () => {
    const summary = [
        { field: 'customerName', label: 'Cliente' },
        { field: 'ndg', label: 'NDG' },
        { field: 'rapportoId', label: 'Rapporto' },
        { field: 'closureDate', label: 'Data', format: 'date' as const },
    ]

    it('renders all fields present in state', () => {
        const md = renderState.renderConfirmSummary({
            state: {
                customerName: 'BELLAFRONTE',
                ndg: '11255521',
                rapportoId: '01-034-00392400',
                closureDate: '2026-04-15',
            },
            summary,
        })
        expect(md).toContain('Cliente')
        expect(md).toContain('15/04/2026')
        expect(md).toContain("Confermi l'invio")
    })

    it('skips fields missing from state', () => {
        const md = renderState.renderConfirmSummary({
            state: { customerName: 'BELLAFRONTE' },
            summary,
        })
        expect(md).toContain('Cliente')
        expect(md).not.toContain('NDG')
    })

    it('shows placeholder when state is empty', () => {
        const md = renderState.renderConfirmSummary({ state: {}, summary })
        expect(md).toContain('nessun dato raccolto')
    })
})

describe('renderState.renderPendingOverwriteConfirm', () => {
    it('renders field+old+new', () => {
        const md = renderState.renderPendingOverwriteConfirm({
            field: 'customerName',
            oldValue: 'Bellafronte',
            newValue: 'Rossi',
        })
        expect(md).toContain('customerName')
        expect(md).toContain('Bellafronte')
        expect(md).toContain('Rossi')
        expect(md).toContain('**sì**')
    })
})

describe('renderState.formatCell — edge', () => {
    it('handles null', () => expect(renderState.formatCell({ value: null })).toBe(''))
    it('handles undefined', () => expect(renderState.formatCell({ value: undefined })).toBe(''))
    it('handles boolean', () => expect(renderState.formatCell({ value: true })).toBe('true'))
    it('handles array', () => expect(renderState.formatCell({ value: [1, 2, 3] })).toContain('3 elementi'))
    it('handles object', () => expect(renderState.formatCell({ value: { x: 1 } })).toContain('oggetto'))
    it('eur with non-numeric string falls back', () => {
        expect(renderState.formatCell({ value: 'abc', format: 'eur' })).toBe('abc')
    })
    it('date with non-ISO string falls back', () => {
        expect(renderState.formatCell({ value: 'not-a-date', format: 'date' })).toBe('not-a-date')
    })
    it('uppercase on number value passes through as string', () => {
        expect(renderState.formatCell({ value: 42, format: 'uppercase' })).toBe('42')
    })
})
