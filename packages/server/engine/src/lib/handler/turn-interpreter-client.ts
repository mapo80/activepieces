import { InteractiveFlowStateField, InterpretTurnRequest, InterpretTurnResponse, PendingInteraction } from '@activepieces/shared'
import { EngineConstants } from './context/engine-constants'

const COMMAND_LAYER_BASE = 'v1/engine/interactive-flow-ai/command-layer'

async function interpret({ constants, request }: InterpretArgs): Promise<InterpretTurnResponse | null> {
    const url = `${constants.internalApiUrl}${COMMAND_LAYER_BASE}/interpret-turn`
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${constants.engineToken}`,
                'Idempotency-Key': request.idempotencyKey,
            },
            body: JSON.stringify(request),
        })
        if (!response.ok && response.status !== 409) {
            return null
        }
        const body = await response.json().catch(() => null) as InterpretTurnResponse | null
        return body
    }
    catch {
        return null
    }
}

async function finalize({ constants, turnId, leaseToken }: FinalizeArgs): Promise<boolean> {
    const url = `${constants.internalApiUrl}${COMMAND_LAYER_BASE}/interpret-turn/finalize`
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${constants.engineToken}`,
            },
            body: JSON.stringify({ turnId, leaseToken }),
        })
        if (!response.ok) return false
        const body = await response.json().catch(() => null) as { ok?: boolean } | null
        return body?.ok === true
    }
    catch {
        return false
    }
}

async function rollback({ constants, turnId, leaseToken, reason }: RollbackArgs): Promise<boolean> {
    const url = `${constants.internalApiUrl}${COMMAND_LAYER_BASE}/interpret-turn/rollback`
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${constants.engineToken}`,
            },
            body: JSON.stringify({ turnId, leaseToken, reason }),
        })
        if (!response.ok) return false
        const body = await response.json().catch(() => null) as { ok?: boolean } | null
        return body?.ok === true
    }
    catch {
        return false
    }
}

function buildCatalogReadiness({ state, stateFields }: {
    state: Record<string, unknown>
    stateFields: InteractiveFlowStateField[]
}): Record<string, boolean> {
    const sources = new Set<string>()
    for (const field of stateFields) {
        if (field.enumFrom) sources.add(field.enumFrom)
    }
    const readiness: Record<string, boolean> = {}
    for (const source of sources) {
        const value = state[source]
        readiness[source] = Array.isArray(value) && value.length > 0
    }
    return readiness
}

export const turnInterpreterClient = {
    interpret,
    finalize,
    rollback,
    buildCatalogReadiness,
}

export type InterpretArgs = {
    constants: EngineConstants
    request: InterpretTurnRequest
}

export type FinalizeArgs = {
    constants: EngineConstants
    turnId: string
    leaseToken: string
}

export type RollbackArgs = {
    constants: EngineConstants
    turnId: string
    leaseToken: string
    reason?: string
}

export type { InterpretTurnRequest, InterpretTurnResponse, PendingInteraction }
