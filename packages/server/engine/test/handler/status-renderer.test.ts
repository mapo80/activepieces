import { describe, expect, it } from 'vitest'
import { statusRenderer } from '../../src/lib/handler/status-renderer'

describe('statusRenderer', () => {
    it('renders Italian success with caseId', () => {
        const out = statusRenderer.render({ state: { caseId: 'CASE-123' }, locale: 'it', success: true })
        expect(out).toContain('CASE-123')
        expect(out.toLowerCase()).toContain('pratica')
    })

    it('renders English success without caseId', () => {
        const out = statusRenderer.render({ state: {}, locale: 'en', success: true })
        expect(out).toContain('Operation completed')
    })

    it('renders Italian success without caseId', () => {
        const out = statusRenderer.render({ state: {}, locale: 'it', success: true })
        expect(out).toContain('Operazione completata')
    })

    it('renders Italian error with reason', () => {
        const out = statusRenderer.render({ state: {}, locale: 'it', success: false, errorReason: 'rete fallita' })
        expect(out).toContain('errore')
        expect(out).toContain('rete fallita')
    })

    it('renders English error without reason', () => {
        const out = statusRenderer.render({ state: {}, locale: 'en', success: false })
        expect(out).toContain('error')
    })

    it('truncates long error reason', () => {
        const longReason = 'X'.repeat(500)
        const out = statusRenderer.render({ state: {}, locale: 'en', success: false, errorReason: longReason })
        expect(out.length).toBeLessThan(500)
    })

    it('combine returns status if preDagAck is empty', () => {
        const out = statusRenderer.combine({ preDagAck: '', status: 'Operation OK' })
        expect(out).toBe('Operation OK')
    })

    it('combine joins preDagAck and status with double newline', () => {
        const out = statusRenderer.combine({ preDagAck: 'Ricevuto', status: 'Operazione completata' })
        expect(out).toBe('Ricevuto\n\nOperazione completata')
    })

    it('default locale is Italian when undefined', () => {
        const out = statusRenderer.render({ state: {}, success: true })
        expect(out).toContain('Operazione')
    })
})
