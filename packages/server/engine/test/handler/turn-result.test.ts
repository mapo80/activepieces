import { describe, expect, it } from 'vitest'
import { emptyTurnResult, TurnResult } from '../../src/lib/handler/turn-result'

describe('emptyTurnResult', () => {
    it('has zero extracted fields', () => {
        expect(emptyTurnResult.extractedFields).toEqual({})
    })
    it('turnAffirmed is false', () => {
        expect(emptyTurnResult.turnAffirmed).toBe(false)
    })
    it('policyDecisions is empty array', () => {
        expect(emptyTurnResult.policyDecisions).toEqual([])
    })
    it('topicChange has no cleared keys', () => {
        expect(emptyTurnResult.topicChange).toEqual({ topicChanged: false, clearedKeys: [] })
    })
    it('pendingOverwriteSignal is null', () => {
        expect(emptyTurnResult.pendingOverwriteSignal).toBeNull()
    })
    it('rejectionHint is null', () => {
        expect(emptyTurnResult.rejectionHint).toBeNull()
    })
    it('shape matches TurnResult type', () => {
        const t: TurnResult = emptyTurnResult
        expect(t).toBeDefined()
    })
})
