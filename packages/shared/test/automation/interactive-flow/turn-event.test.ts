import { describe, expect, it } from 'vitest'
import { InteractiveFlowTurnEventSchema } from '../../../src/lib/automation/interactive-flow/turn-event'

const validBase = {
    outboxEventId: '00000000-0000-4000-8000-000000000000',
    turnId: 'turn-1',
    sessionId: 'sess-1',
    flowRunId: 'run-1',
    sessionSequence: '1',
    timestamp: new Date().toISOString(),
}

describe('InteractiveFlowTurnEventSchema', () => {
    it.each([
        'FIELD_EXTRACTED',
        'FIELD_REJECTED',
        'META_ANSWERED',
        'INFO_ANSWERED',
        'TOPIC_CHANGED',
        'OVERWRITE_PENDING',
        'OVERWRITE_CONFIRMED',
        'OVERWRITE_REJECTED',
        'CANCEL_REQUESTED',
        'CANCEL_CONFIRMED',
        'CANCEL_REJECTED',
        'CANCEL_TTL_EXPIRED',
        'REPROMPT_EMITTED',
        'TURN_COMMITTED',
        'TURN_ROLLED_BACK',
        'TURN_LEASE_EXPIRED',
        'TURN_FAILED',
        'CATALOG_PREEXEC_FAILED',
    ])('accepts kind=%s', (kind) => {
        expect(InteractiveFlowTurnEventSchema.safeParse({ ...validBase, kind, payload: {} }).success).toBe(true)
    })
    it('rejects unknown kind', () => {
        expect(InteractiveFlowTurnEventSchema.safeParse({ ...validBase, kind: 'BOGUS', payload: {} }).success).toBe(false)
    })
    it('rejects bad sessionSequence (zero) and emits validation.bigint.format', () => {
        const r = InteractiveFlowTurnEventSchema.safeParse({ ...validBase, sessionSequence: '0', kind: 'TURN_COMMITTED', payload: {} })
        expect(r.success).toBe(false)
        if (!r.success) {
            const msg = r.error.issues.find(i => i.path.join('.') === 'sessionSequence')?.message
            expect(msg).toBe('validation.bigint.format')
        }
    })
    it('rejects sessionSequence with leading zeroes', () => {
        expect(InteractiveFlowTurnEventSchema.safeParse({ ...validBase, sessionSequence: '012', kind: 'TURN_COMMITTED', payload: {} }).success).toBe(false)
    })
    it('rejects sessionSequence non-numeric', () => {
        expect(InteractiveFlowTurnEventSchema.safeParse({ ...validBase, sessionSequence: 'abc', kind: 'TURN_COMMITTED', payload: {} }).success).toBe(false)
    })
    it('accepts large bigint string', () => {
        expect(InteractiveFlowTurnEventSchema.safeParse({ ...validBase, sessionSequence: '9007199254740993', kind: 'TURN_COMMITTED', payload: {} }).success).toBe(true)
    })
    it('rejects when missing required outboxEventId', () => {
        const { outboxEventId: _drop, ...rest } = validBase
        expect(InteractiveFlowTurnEventSchema.safeParse({ ...rest, kind: 'TURN_COMMITTED', payload: {} }).success).toBe(false)
    })
    it('rejects when outboxEventId is not a UUID', () => {
        expect(InteractiveFlowTurnEventSchema.safeParse({ ...validBase, outboxEventId: 'not-a-uuid', kind: 'TURN_COMMITTED', payload: {} }).success).toBe(false)
    })
    it('rejects empty turnId', () => {
        expect(InteractiveFlowTurnEventSchema.safeParse({ ...validBase, turnId: '', kind: 'TURN_COMMITTED', payload: {} }).success).toBe(false)
    })
    it('rejects when payload is not an object', () => {
        expect(InteractiveFlowTurnEventSchema.safeParse({ ...validBase, kind: 'TURN_COMMITTED', payload: 'string-not-object' }).success).toBe(false)
    })
})
