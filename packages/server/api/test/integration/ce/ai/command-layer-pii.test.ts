import { describe, expect, it } from 'vitest'
import { piiRedactor } from '../../../../src/app/ai/command-layer/pii-redactor'

describe('piiRedactor', () => {
    it('redacts email addresses', () => {
        const out = piiRedactor.redactString('Email me at john.doe@bank.com please')
        expect(out).toContain('[REDACTED]')
        expect(out).not.toContain('john.doe@bank.com')
    })

    it('redacts Italian fiscal code', () => {
        const out = piiRedactor.redactString('Codice fiscale: RSSMRA80A01H501Z')
        expect(out).toContain('[REDACTED]')
        expect(out).not.toContain('RSSMRA80A01H501Z')
    })

    it('redacts IBAN', () => {
        const out = piiRedactor.redactString('IBAN IT60X0542811101000000123456')
        expect(out).toContain('[REDACTED]')
        expect(out).not.toContain('IT60X0542811101000000123456')
    })

    it('redacts phone number', () => {
        const out = piiRedactor.redactString('Chiama +39 333 1234567')
        expect(out).toContain('[REDACTED]')
        expect(out).not.toContain('333 1234567')
    })

    it('redacts NDG-like long digits', () => {
        const out = piiRedactor.redactString('NDG 11255521')
        expect(out).toContain('[REDACTED]')
        expect(out).not.toContain('11255521')
    })

    it('redacts sensitive state fields entirely', () => {
        const state = { customerName: 'Mario Rossi', password: 'secret123' }
        const out = piiRedactor.redactState({
            state,
            stateFields: [
                { name: 'customerName', type: 'string' },
                { name: 'password', type: 'string', sensitive: true },
            ],
        })
        expect(out.password).toBe('[REDACTED]')
        expect(out.customerName).toBe('Mario Rossi')
    })

    it('redacts nested objects to depth limit', () => {
        const payload = { profile: { email: 'a@b.com', phone: '+39 111 2233445' } }
        const out = piiRedactor.redactPayload(payload)
        const profile = out.profile as Record<string, unknown>
        expect(profile.email).toContain('[REDACTED]')
        expect(profile.phone).toContain('[REDACTED]')
    })

    it('handles primitive values without crashing', () => {
        expect(piiRedactor.redactValue({ value: 42, depth: 0 })).toBe(42)
        expect(piiRedactor.redactValue({ value: true, depth: 0 })).toBe(true)
        expect(piiRedactor.redactValue({ value: null, depth: 0 })).toBe(null)
    })

    it('caps recursion depth', () => {
        const deeply: { x: unknown } = { x: null }
        let cur: { x: unknown } = deeply
        for (let i = 0; i < 10; i++) {
            cur.x = { x: null }
            cur = cur.x as { x: unknown }
        }
        const out = piiRedactor.redactPayload(deeply)
        expect(JSON.stringify(out)).toContain('DEPTH_LIMIT')
    })
})
