import { describe, expect, it } from 'vitest'
import {
    FinalizeTurnRequestSchema,
    InterpretTurnRequestSchema,
    InterpretTurnResponseSchema,
    RollbackTurnRequestSchema,
} from '../../../src/lib/automation/interactive-flow/turn-interpret-dto'

const validRequest = {
    turnId: 't-1',
    idempotencyKey: 'i-1',
    sessionId: 's-1',
    sessionRevision: 0,
    flowRunId: 'fr-1',
    flowVersionId: 'v-1',
    message: 'hello',
    state: {},
    history: [],
    pendingInteraction: null,
    stateFields: [],
    nodes: [],
    currentNodeHint: null,
    infoIntents: [],
    locale: 'it',
    catalogReadiness: {},
}

const validResponse = {
    turnStatus: 'prepared',
    messageOut: { preDagAck: 'ack', kind: 'ack-only' },
    stateDiff: {},
    pendingInteractionNext: null,
    topicChange: { topicChanged: false, clearedKeys: [] },
    pendingOverwriteSignal: null,
    rejectionHint: null,
    lastPolicyDecisions: [],
    turnEvents: [],
    acceptedCommands: [],
    rejectedCommands: [],
    finalizeContract: { turnId: 't', leaseToken: '00000000-0000-4000-8000-000000000000' },
}

describe('InterpretTurnRequestSchema', () => {
    it('accepts minimal valid request', () => {
        expect(InterpretTurnRequestSchema.safeParse(validRequest).success).toBe(true)
    })
    it('rejects empty turnId', () => {
        expect(InterpretTurnRequestSchema.safeParse({ ...validRequest, turnId: '' }).success).toBe(false)
    })
    it('rejects empty idempotencyKey', () => {
        expect(InterpretTurnRequestSchema.safeParse({ ...validRequest, idempotencyKey: '' }).success).toBe(false)
    })
    it('rejects history entry with missing role', () => {
        expect(InterpretTurnRequestSchema.safeParse({ ...validRequest, history: [{ text: 'x' }] }).success).toBe(false)
    })
    it('accepts history with multiple entries (user/assistant)', () => {
        expect(InterpretTurnRequestSchema.safeParse({
            ...validRequest,
            history: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'hello' }],
        }).success).toBe(true)
    })
    it('accepts pendingInteraction null', () => {
        expect(InterpretTurnRequestSchema.safeParse({ ...validRequest, pendingInteraction: null }).success).toBe(true)
    })
    it('rejects negative sessionRevision', () => {
        expect(InterpretTurnRequestSchema.safeParse({ ...validRequest, sessionRevision: -1 }).success).toBe(false)
    })
    it('rejects non-integer sessionRevision', () => {
        expect(InterpretTurnRequestSchema.safeParse({ ...validRequest, sessionRevision: 1.5 }).success).toBe(false)
    })
    it('accepts optional systemPrompt + locale', () => {
        expect(InterpretTurnRequestSchema.safeParse({ ...validRequest, systemPrompt: 'sys', locale: 'en' }).success).toBe(true)
    })
})

describe('InterpretTurnResponseSchema', () => {
    it('accepts minimal prepared', () => {
        expect(InterpretTurnResponseSchema.safeParse(validResponse).success).toBe(true)
    })
    it('accepts replayed', () => {
        expect(InterpretTurnResponseSchema.safeParse({ ...validResponse, turnStatus: 'replayed' }).success).toBe(true)
    })
    it('accepts failed', () => {
        expect(InterpretTurnResponseSchema.safeParse({ ...validResponse, turnStatus: 'failed' }).success).toBe(true)
    })
    it('rejects unknown turnStatus', () => {
        expect(InterpretTurnResponseSchema.safeParse({ ...validResponse, turnStatus: 'pending' }).success).toBe(false)
    })
    it('rejects when finalizeContract leaseToken is not UUID', () => {
        expect(InterpretTurnResponseSchema.safeParse({
            ...validResponse,
            finalizeContract: { turnId: 't', leaseToken: 'not-a-uuid' },
        }).success).toBe(false)
    })
    it('accepts sessionSequenceRange with bigint strings', () => {
        expect(InterpretTurnResponseSchema.safeParse({
            ...validResponse,
            sessionSequenceRange: { from: '1', to: '5' },
        }).success).toBe(true)
    })
    it('rejects sessionSequenceRange.from = 0', () => {
        expect(InterpretTurnResponseSchema.safeParse({
            ...validResponse,
            sessionSequenceRange: { from: '0', to: '5' },
        }).success).toBe(false)
    })
})

describe('FinalizeTurnRequestSchema', () => {
    it('accepts UUID leaseToken', () => {
        expect(FinalizeTurnRequestSchema.safeParse({ turnId: 't', leaseToken: '00000000-0000-4000-8000-000000000000' }).success).toBe(true)
    })
    it('rejects non-UUID leaseToken', () => {
        expect(FinalizeTurnRequestSchema.safeParse({ turnId: 't', leaseToken: 'not-uuid' }).success).toBe(false)
    })
    it('rejects empty turnId', () => {
        expect(FinalizeTurnRequestSchema.safeParse({ turnId: '', leaseToken: '00000000-0000-4000-8000-000000000000' }).success).toBe(false)
    })
})

describe('RollbackTurnRequestSchema', () => {
    it('accepts optional reason', () => {
        expect(RollbackTurnRequestSchema.safeParse({ turnId: 't', leaseToken: '00000000-0000-4000-8000-000000000000', reason: 'engine-error' }).success).toBe(true)
        expect(RollbackTurnRequestSchema.safeParse({ turnId: 't', leaseToken: '00000000-0000-4000-8000-000000000000' }).success).toBe(true)
    })
    it('rejects non-UUID leaseToken', () => {
        expect(RollbackTurnRequestSchema.safeParse({ turnId: 't', leaseToken: 'invalid' }).success).toBe(false)
    })
})
