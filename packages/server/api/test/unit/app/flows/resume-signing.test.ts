import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../src/app/helper/system/system', () => ({
    system: {
        getOrThrow: vi.fn().mockReturnValue('test-secret-do-not-use-in-prod'),
    },
}))

import { signResume, verifyResumeSignature } from '../../../../src/app/flows/flow-run/waitpoint/resume-signing'

describe('resume-signing', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('signs and verifies a valid (runId, waitpointId) pair', () => {
        const runId = 'abc123DEF456ghi789JKL'
        const waitpointId = 'wp1234567890123456789'
        const sig = signResume(runId, waitpointId)
        expect(sig).toMatch(/^v1\.[0-9a-f]+$/)
        expect(verifyResumeSignature(runId, waitpointId, sig)).toBe(true)
    })

    it('rejects the same signature on a different runId', () => {
        const runId = 'abc123DEF456ghi789JKL'
        const waitpointId = 'wp1234567890123456789'
        const sig = signResume(runId, waitpointId)
        expect(verifyResumeSignature('zzz999ZZZ999zzz999ZZZ', waitpointId, sig)).toBe(false)
    })

    it('rejects the same signature on a different waitpointId', () => {
        const runId = 'abc123DEF456ghi789JKL'
        const waitpointId = 'wp1234567890123456789'
        const sig = signResume(runId, waitpointId)
        expect(verifyResumeSignature(runId, 'wp9999999999999999999', sig)).toBe(false)
    })

    it('rejects missing / empty signature', () => {
        const runId = 'abc123DEF456ghi789JKL'
        const waitpointId = 'wp1234567890123456789'
        expect(verifyResumeSignature(runId, waitpointId, undefined)).toBe(false)
        expect(verifyResumeSignature(runId, waitpointId, '')).toBe(false)
    })

    it('rejects a tampered signature of different length', () => {
        const runId = 'abc123DEF456ghi789JKL'
        const waitpointId = 'wp1234567890123456789'
        expect(verifyResumeSignature(runId, waitpointId, 'v1.ffff')).toBe(false)
    })

    it('rejects a tampered signature of same length', () => {
        const runId = 'abc123DEF456ghi789JKL'
        const waitpointId = 'wp1234567890123456789'
        const sig = signResume(runId, waitpointId)
        const tampered = 'v1.' + '0'.repeat(sig.length - 3)
        expect(verifyResumeSignature(runId, waitpointId, tampered)).toBe(false)
    })
})
