import { describe, expect, it } from 'vitest'
import { ConversationCommandSchema } from '../../../src/lib/automation/interactive-flow/conversation-command'

describe('ConversationCommandSchema', () => {
    describe('SET_FIELDS', () => {
        it('accepts valid update with evidence', () => {
            expect(ConversationCommandSchema.safeParse({
                type: 'SET_FIELDS',
                updates: [{ field: 'customerName', value: 'Bellafronte', evidence: 'Bellafronte' }],
            }).success).toBe(true)
        })
        it('rejects empty updates array', () => {
            expect(ConversationCommandSchema.safeParse({ type: 'SET_FIELDS', updates: [] }).success).toBe(false)
        })
        it('rejects evidence shorter than 2 chars', () => {
            expect(ConversationCommandSchema.safeParse({
                type: 'SET_FIELDS',
                updates: [{ field: 'x', value: 'y', evidence: 'z' }],
            }).success).toBe(false)
        })
        it('rejects empty field name', () => {
            expect(ConversationCommandSchema.safeParse({
                type: 'SET_FIELDS',
                updates: [{ field: '', value: 'y', evidence: 'zz' }],
            }).success).toBe(false)
        })
        it('accepts confidence in [0..1]', () => {
            expect(ConversationCommandSchema.safeParse({
                type: 'SET_FIELDS',
                updates: [{ field: 'x', value: 'y', evidence: 'zz', confidence: 0.5 }],
            }).success).toBe(true)
        })
        it('rejects confidence > 1', () => {
            expect(ConversationCommandSchema.safeParse({
                type: 'SET_FIELDS',
                updates: [{ field: 'x', value: 'y', evidence: 'zz', confidence: 1.5 }],
            }).success).toBe(false)
        })
        it('rejects confidence < 0', () => {
            expect(ConversationCommandSchema.safeParse({
                type: 'SET_FIELDS',
                updates: [{ field: 'x', value: 'y', evidence: 'zz', confidence: -0.1 }],
            }).success).toBe(false)
        })
    })
    describe('ASK_FIELD', () => {
        it('accepts with reason', () => {
            expect(ConversationCommandSchema.safeParse({ type: 'ASK_FIELD', field: 'name', reason: 'missing' }).success).toBe(true)
        })
        it('accepts without reason', () => {
            expect(ConversationCommandSchema.safeParse({ type: 'ASK_FIELD', field: 'name' }).success).toBe(true)
        })
        it('rejects when field missing', () => {
            expect(ConversationCommandSchema.safeParse({ type: 'ASK_FIELD' }).success).toBe(false)
        })
        it('rejects empty field', () => {
            expect(ConversationCommandSchema.safeParse({ type: 'ASK_FIELD', field: '' }).success).toBe(false)
        })
    })
    describe('ANSWER_META', () => {
        it.each(['ask-repeat', 'ask-clarify', 'ask-progress', 'ask-help'])('accepts kind=%s', (kind) => {
            expect(ConversationCommandSchema.safeParse({ type: 'ANSWER_META', kind }).success).toBe(true)
        })
        it('accepts with optional message', () => {
            expect(ConversationCommandSchema.safeParse({ type: 'ANSWER_META', kind: 'ask-repeat', message: 'hi' }).success).toBe(true)
        })
        it('rejects unknown kind', () => {
            expect(ConversationCommandSchema.safeParse({ type: 'ANSWER_META', kind: 'unknown' }).success).toBe(false)
        })
    })
    describe('ANSWER_INFO', () => {
        it('accepts with citedFields ≥1', () => {
            expect(ConversationCommandSchema.safeParse({ type: 'ANSWER_INFO', infoIntent: 'count_accounts', citedFields: ['ndg'] }).success).toBe(true)
        })
        it('rejects empty citedFields', () => {
            expect(ConversationCommandSchema.safeParse({ type: 'ANSWER_INFO', infoIntent: 'count_accounts', citedFields: [] }).success).toBe(false)
        })
        it('rejects empty infoIntent', () => {
            expect(ConversationCommandSchema.safeParse({ type: 'ANSWER_INFO', infoIntent: '', citedFields: ['ndg'] }).success).toBe(false)
        })
    })
    describe('REQUEST_CANCEL / RESOLVE_PENDING / REPROMPT', () => {
        it('REQUEST_CANCEL accepts optional reason', () => {
            expect(ConversationCommandSchema.safeParse({ type: 'REQUEST_CANCEL' }).success).toBe(true)
            expect(ConversationCommandSchema.safeParse({ type: 'REQUEST_CANCEL', reason: 'too long' }).success).toBe(true)
        })
        it('RESOLVE_PENDING requires both decision + pendingType', () => {
            expect(ConversationCommandSchema.safeParse({ type: 'RESOLVE_PENDING', decision: 'accept', pendingType: 'confirm_binary' }).success).toBe(true)
            expect(ConversationCommandSchema.safeParse({ type: 'RESOLVE_PENDING', decision: 'accept' }).success).toBe(false)
        })
        it('RESOLVE_PENDING rejects unknown decision', () => {
            expect(ConversationCommandSchema.safeParse({ type: 'RESOLVE_PENDING', decision: 'maybe', pendingType: 'confirm_binary' }).success).toBe(false)
        })
        it('RESOLVE_PENDING rejects unknown pendingType', () => {
            expect(ConversationCommandSchema.safeParse({ type: 'RESOLVE_PENDING', decision: 'accept', pendingType: 'bogus' }).success).toBe(false)
        })
        it('REPROMPT requires reason from enum', () => {
            expect(ConversationCommandSchema.safeParse({ type: 'REPROMPT', reason: 'low-confidence' }).success).toBe(true)
            expect(ConversationCommandSchema.safeParse({ type: 'REPROMPT', reason: 'unknown' }).success).toBe(false)
        })
        it.each(['low-confidence', 'policy-rejected', 'off-topic', 'ambiguous-input', 'provider-error', 'catalog-not-ready'])('REPROMPT accepts reason=%s', (reason) => {
            expect(ConversationCommandSchema.safeParse({ type: 'REPROMPT', reason }).success).toBe(true)
        })
    })
    it('rejects unknown type', () => {
        expect(ConversationCommandSchema.safeParse({ type: 'UNKNOWN_TYPE' }).success).toBe(false)
    })
})
