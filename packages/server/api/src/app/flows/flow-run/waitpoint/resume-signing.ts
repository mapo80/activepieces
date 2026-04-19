import { createHmac, timingSafeEqual } from 'node:crypto'
import { system } from '../../../helper/system/system'
import { AppSystemProp } from '../../../helper/system/system-props'

const HMAC_ALGORITHM = 'sha256'
const HMAC_VERSION = 'v1'

function getSecret(): string {
    return system.getOrThrow(AppSystemProp.JWT_SECRET)
}

function computeSignature(flowRunId: string, waitpointId: string): string {
    const payload = `${HMAC_VERSION}:${flowRunId}:${waitpointId}`
    const mac = createHmac(HMAC_ALGORITHM, getSecret())
    mac.update(payload)
    return `${HMAC_VERSION}.${mac.digest('hex')}`
}

export function signResume(flowRunId: string, waitpointId: string): string {
    return computeSignature(flowRunId, waitpointId)
}

export function verifyResumeSignature(flowRunId: string, waitpointId: string, signature: string | undefined): boolean {
    if (!signature || typeof signature !== 'string' || signature.length === 0) {
        return false
    }
    const expected = computeSignature(flowRunId, waitpointId)
    try {
        const a = Buffer.from(expected)
        const b = Buffer.from(signature)
        if (a.length !== b.length) {
            return false
        }
        return timingSafeEqual(a, b)
    }
    catch {
        return false
    }
}
