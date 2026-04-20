import { Store, StoreScope } from '@activepieces/pieces-framework'
import { InteractiveFlowStateField, isNil } from '@activepieces/shared'
import { createContextStore } from '../piece-context/store'
import { EngineConstants } from './context/engine-constants'

function buildStore({ constants }: { constants: EngineConstants }): Store {
    return createContextStore({
        apiUrl: constants.internalApiUrl,
        prefix: `${constants.projectId}/`,
        flowId: constants.flowId,
        engineToken: constants.engineToken,
    })
}

function makeSessionKey({ actionName, sessionNamespace, sessionId }: {
    actionName: string
    sessionNamespace: string | undefined
    sessionId: string
}): string {
    const ns = (sessionNamespace ?? actionName).trim().toLowerCase()
    const id = sessionId.trim()
    return `ifsession:${ns}:${id}`
}

async function load({ key, constants, currentFlowVersionId }: {
    key: string
    constants: EngineConstants
    currentFlowVersionId: string
}): Promise<{ record: SessionRecord | null, versionMismatch: boolean }> {
    const store = buildStore({ constants })
    const raw = await store.get<SessionRecord>(key, StoreScope.FLOW)
    if (isNil(raw)) return { record: null, versionMismatch: false }
    if (raw.flowVersionId !== currentFlowVersionId) {
        return { record: raw, versionMismatch: true }
    }
    return { record: raw, versionMismatch: false }
}

async function save({ key, constants, state, history, flowVersionId, historyMaxTurns }: {
    key: string
    constants: EngineConstants
    state: Record<string, unknown>
    history: HistoryEntry[]
    flowVersionId: string
    historyMaxTurns: number
}): Promise<{ bytes: number, truncated: boolean }> {
    const store = buildStore({ constants })
    const cappedHistory = history.slice(-historyMaxTurns)
    const payload: SessionRecord = {
        state,
        history: cappedHistory,
        flowVersionId,
        lastTurnAt: new Date().toISOString(),
    }
    let bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8')
    let truncated = false
    if (bytes > SESSION_SOFT_LIMIT_BYTES) {
        payload.history = payload.history.slice(-SESSION_DEGRADED_HISTORY_TURNS)
        truncated = true
        bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8')
    }
    await store.put(key, payload, StoreScope.FLOW)
    return { bytes, truncated }
}

async function clear({ key, constants }: {
    key: string
    constants: EngineConstants
}): Promise<void> {
    const store = buildStore({ constants })
    await store.delete(key, StoreScope.FLOW)
}

function detectTopicChange({ previousState, incoming, fields }: {
    previousState: Record<string, unknown>
    incoming: Record<string, unknown>
    fields: InteractiveFlowStateField[]
}): boolean {
    const extractableByName = new Set(
        fields
            .filter(f => f.extractable !== false)
            .map(f => f.name),
    )
    for (const [k, v] of Object.entries(incoming)) {
        if (isNil(v)) continue
        if (!extractableByName.has(k)) continue
        const prev = previousState[k]
        if (isNil(prev)) continue
        if (!isEqualValue(prev, v)) return true
    }
    return false
}

function applyStateOverwriteWithTopicChange({ flowState, incoming, fields }: {
    flowState: Record<string, unknown>
    incoming: Record<string, unknown>
    fields: InteractiveFlowStateField[]
}): { topicChanged: boolean, appliedKeys: string[] } {
    const appliedKeys: string[] = []
    const topicChanged = detectTopicChange({ previousState: flowState, incoming, fields })
    for (const [k, v] of Object.entries(incoming)) {
        if (isNil(v)) continue
        flowState[k] = v
        appliedKeys.push(k)
    }
    if (topicChanged) {
        for (const f of fields) {
            if (f.extractable === false && f.name in flowState) {
                Reflect.deleteProperty(flowState, f.name)
            }
        }
    }
    return { topicChanged, appliedKeys }
}

function appendHistory({ history, role, text, historyMaxTurns }: {
    history: HistoryEntry[]
    role: 'user' | 'assistant'
    text: string
    historyMaxTurns: number
}): HistoryEntry[] {
    if (text.trim().length === 0) return history
    return [...history, { role, text }].slice(-historyMaxTurns)
}

function isEqualValue(a: unknown, b: unknown): boolean {
    if (a === b) return true
    try {
        return JSON.stringify(a) === JSON.stringify(b)
    }
    catch {
        return false
    }
}

export const sessionStore = {
    makeSessionKey,
    load,
    save,
    clear,
    detectTopicChange,
    applyStateOverwriteWithTopicChange,
    appendHistory,
}

export const DEFAULT_HISTORY_MAX_TURNS = 20
export const SESSION_SOFT_LIMIT_BYTES = 400 * 1024
export const SESSION_DEGRADED_HISTORY_TURNS = 5

export type HistoryEntry = {
    role: 'user' | 'assistant'
    text: string
}

export type SessionRecord = {
    state: Record<string, unknown>
    history: HistoryEntry[]
    flowVersionId: string
    lastTurnAt: string
}
