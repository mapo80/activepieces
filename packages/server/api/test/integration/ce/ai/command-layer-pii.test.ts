import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { outboxService } from '../../../../src/app/ai/command-layer/outbox.service'
import { piiRedactor } from '../../../../src/app/ai/command-layer/pii-redactor'
import { databaseConnection } from '../../../../src/app/database/database-connection'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

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

describe('H-05: outbox.service redacts payload before persist', () => {
    beforeAll(async () => {
        await setupTestEnvironment()
    })
    afterAll(async () => {
        await teardownTestEnvironment()
    })
    beforeEach(async () => {
        const ds = databaseConnection()
        await ds.query('DELETE FROM "interactive_flow_outbox"')
        await ds.query('DELETE FROM "interactive_flow_session_sequence"')
    })

    it('email-like value is redacted in DB row', async () => {
        const inserted = await outboxService.insertPending({
            turnId: `turn-${randomUUID()}`,
            sessionId: `sess-h05-${randomUUID()}`,
            flowRunId: 'run-h05',
            events: [{
                eventType: 'FIELD_EXTRACTED',
                payload: { field: 'email', value: 'user@example.com', evidence: 'user@example.com' },
            }],
        })
        const ds = databaseConnection()
        const row = await ds.query(
            'SELECT "payload" FROM "interactive_flow_outbox" WHERE "outboxEventId" = $1',
            [inserted[0].outboxEventId],
        )
        const persisted = row[0].payload as { value: string, evidence: string }
        expect(persisted.value).not.toBe('user@example.com')
        expect(persisted.value).toContain('[REDACTED]')
        expect(persisted.evidence).toContain('[REDACTED]')
    })

    it('non-object payload (null) passes through untouched', async () => {
        const inserted = await outboxService.insertPending({
            turnId: `turn-${randomUUID()}`,
            sessionId: `sess-h05-null-${randomUUID()}`,
            flowRunId: 'run-h05-null',
            events: [{ eventType: 'TURN_COMMITTED', payload: null as unknown as Record<string, unknown> }],
        })
        const ds = databaseConnection()
        const row = await ds.query(
            'SELECT "payload" FROM "interactive_flow_outbox" WHERE "outboxEventId" = $1',
            [inserted[0].outboxEventId],
        )
        expect(row[0].payload).toBeNull()
    })

    it('array payload passes through untouched (no object redaction)', async () => {
        const inserted = await outboxService.insertPending({
            turnId: `turn-${randomUUID()}`,
            sessionId: `sess-h05-arr-${randomUUID()}`,
            flowRunId: 'run-h05-arr',
            events: [{ eventType: 'TURN_COMMITTED', payload: ['a', 'b'] as unknown as Record<string, unknown> }],
        })
        const ds = databaseConnection()
        const row = await ds.query(
            'SELECT "payload" FROM "interactive_flow_outbox" WHERE "outboxEventId" = $1',
            [inserted[0].outboxEventId],
        )
        expect(row[0].payload).toEqual(['a', 'b'])
    })

    it('IBAN inside nested payload object is redacted', async () => {
        const inserted = await outboxService.insertPending({
            turnId: `turn-${randomUUID()}`,
            sessionId: `sess-h05-iban-${randomUUID()}`,
            flowRunId: 'run-h05-iban',
            events: [{
                eventType: 'FIELD_EXTRACTED',
                payload: { profile: { iban: 'IT60X0542811101000000123456' } },
            }],
        })
        const ds = databaseConnection()
        const row = await ds.query(
            'SELECT "payload" FROM "interactive_flow_outbox" WHERE "outboxEventId" = $1',
            [inserted[0].outboxEventId],
        )
        const persisted = row[0].payload as { profile: { iban: string } }
        expect(persisted.profile.iban).not.toContain('IT60X0542811101000000123456')
        expect(persisted.profile.iban).toContain('[REDACTED]')
    })
})
