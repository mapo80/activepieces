import { Store, StoreScope } from '@activepieces/pieces-framework'
import { InteractiveFlowNode, InteractiveFlowStateField, isNil, PendingInteraction } from '@activepieces/shared'
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

async function save({ key, constants, state, history, flowVersionId, historyMaxTurns, pendingInteraction }: {
    key: string
    constants: EngineConstants
    state: Record<string, unknown>
    history: HistoryEntry[]
    flowVersionId: string
    historyMaxTurns: number
    pendingInteraction?: PendingInteraction | null
}): Promise<{ bytes: number, truncated: boolean }> {
    const store = buildStore({ constants })
    const cappedHistory = history.slice(-historyMaxTurns)
    const payload: SessionRecord = {
        state,
        history: cappedHistory,
        flowVersionId,
        lastTurnAt: new Date().toISOString(),
    }
    if (!isNil(pendingInteraction)) {
        payload.pendingInteraction = pendingInteraction
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

function applyStateOverwriteWithTopicChange({ flowState, incoming, fields, nodes }: {
    flowState: Record<string, unknown>
    incoming: Record<string, unknown>
    fields: InteractiveFlowStateField[]
    nodes?: InteractiveFlowNode[]
}): { topicChanged: boolean, appliedKeys: string[], clearedKeys: string[] } {
    const appliedKeys: string[] = []
    const clearedKeys: string[] = []
    const changedExtractableFields = collectChangedExtractableFields({
        previousState: flowState,
        incoming,
        fields,
    })
    const topicChanged = changedExtractableFields.length > 0

    if (topicChanged && nodes && nodes.length > 0) {
        const depGraph = buildDependencyGraph({ nodes })
        const staleFields = new Set<string>()
        for (const changed of changedExtractableFields) {
            const downstream = depGraph.get(changed)
            if (!downstream) continue
            for (const d of downstream) staleFields.add(d)
        }
        for (const incomingKey of Object.keys(incoming)) {
            staleFields.delete(incomingKey)
        }
        for (const stale of staleFields) {
            if (stale in flowState) {
                Reflect.deleteProperty(flowState, stale)
                clearedKeys.push(stale)
            }
        }
    }

    for (const [k, v] of Object.entries(incoming)) {
        if (isNil(v)) continue
        flowState[k] = v
        appliedKeys.push(k)
    }

    if (topicChanged && (!nodes || nodes.length === 0)) {
        for (const f of fields) {
            if (f.extractable === false && f.name in flowState) {
                Reflect.deleteProperty(flowState, f.name)
                clearedKeys.push(f.name)
            }
        }
    }

    return { topicChanged, appliedKeys, clearedKeys }
}

function collectChangedExtractableFields({ previousState, incoming, fields }: {
    previousState: Record<string, unknown>
    incoming: Record<string, unknown>
    fields: InteractiveFlowStateField[]
}): string[] {
    const extractableByName = new Set(
        fields
            .filter(f => f.extractable !== false)
            .map(f => f.name),
    )
    const changed: string[] = []
    for (const [k, v] of Object.entries(incoming)) {
        if (isNil(v)) continue
        if (!extractableByName.has(k)) continue
        const prev = previousState[k]
        if (isNil(prev)) continue
        if (!isEqualValue(prev, v)) changed.push(k)
    }
    return changed
}

function buildDependencyGraph({ nodes }: {
    nodes: InteractiveFlowNode[]
}): Map<string, Set<string>> {
    const directDependents = new Map<string, Set<string>>()
    for (const node of nodes) {
        const inputs = node.stateInputs ?? []
        const outputs = node.stateOutputs ?? []
        if (inputs.length === 0 || outputs.length === 0) continue
        for (const input of inputs) {
            let dependents = directDependents.get(input)
            if (!dependents) {
                dependents = new Set<string>()
                directDependents.set(input, dependents)
            }
            for (const output of outputs) {
                if (output === input) continue
                dependents.add(output)
            }
        }
    }
    const transitive = new Map<string, Set<string>>()
    for (const source of directDependents.keys()) {
        const visited = new Set<string>()
        const queue: string[] = [source]
        while (queue.length > 0) {
            const cur = queue.shift() as string
            const direct = directDependents.get(cur)
            if (!direct) continue
            for (const d of direct) {
                if (d === source) continue
                if (visited.has(d)) continue
                visited.add(d)
                queue.push(d)
            }
        }
        transitive.set(source, visited)
    }
    return transitive
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
    if (isPrimitiveScalar(a) && isPrimitiveScalar(b)) {
        return String(a).trim().toLowerCase() === String(b).trim().toLowerCase()
    }
    try {
        return JSON.stringify(a) === JSON.stringify(b)
    }
    catch {
        return false
    }
}

function isPrimitiveScalar(v: unknown): boolean {
    return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
}

async function loadWithRevision({ key, constants, currentFlowVersionId }: {
    key: string
    constants: EngineConstants
    currentFlowVersionId: string
}): Promise<{ record: SessionRecord | null, versionMismatch: boolean, sessionRevision: number }> {
    const url = `${constants.internalApiUrl}v1/store-entries/with-version?key=${encodeURIComponent(key)}`
    try {
        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${constants.engineToken}` },
        })
        if (response.status === 404) {
            return { record: null, versionMismatch: false, sessionRevision: 0 }
        }
        if (!response.ok) {
            const fallback = await load({ key, constants, currentFlowVersionId })
            return { ...fallback, sessionRevision: 0 }
        }
        const body = await response.json() as { value: SessionRecord, version: number } | null
        if (!body) return { record: null, versionMismatch: false, sessionRevision: 0 }
        if (body.value && body.value.flowVersionId !== currentFlowVersionId) {
            return { record: body.value, versionMismatch: true, sessionRevision: body.version }
        }
        return { record: body.value, versionMismatch: false, sessionRevision: body.version }
    }
    catch {
        const fallback = await load({ key, constants, currentFlowVersionId })
        return { ...fallback, sessionRevision: 0 }
    }
}

async function saveWithCAS({ key, constants, state, history, flowVersionId, historyMaxTurns, pendingInteraction, expectedRevision }: {
    key: string
    constants: EngineConstants
    state: Record<string, unknown>
    history: HistoryEntry[]
    flowVersionId: string
    historyMaxTurns: number
    pendingInteraction?: PendingInteraction | null
    expectedRevision: number
}): Promise<{ status: 'ok' | 'conflict', newRevision?: number, currentRevision?: number }> {
    const cappedHistory = history.slice(-historyMaxTurns)
    const payload: SessionRecord = {
        state,
        history: cappedHistory,
        flowVersionId,
        lastTurnAt: new Date().toISOString(),
    }
    if (!isNil(pendingInteraction)) {
        payload.pendingInteraction = pendingInteraction
    }
    const url = `${constants.internalApiUrl}v1/store-entries/put-with-version`
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${constants.engineToken}`,
            },
            body: JSON.stringify({ key, value: payload, expectedVersion: expectedRevision }),
        })
        if (response.status === 412) {
            const body = await response.json().catch(() => null) as { currentVersion?: number } | null
            return { status: 'conflict', currentRevision: body?.currentVersion ?? 0 }
        }
        if (!response.ok) {
            await save({ key, constants, state, history: cappedHistory, flowVersionId, historyMaxTurns, pendingInteraction })
            return { status: 'ok' }
        }
        const body = await response.json().catch(() => null) as { version?: number } | null
        return { status: 'ok', newRevision: body?.version ?? expectedRevision + 1 }
    }
    catch {
        await save({ key, constants, state, history: cappedHistory, flowVersionId, historyMaxTurns, pendingInteraction })
        return { status: 'ok' }
    }
}

export const sessionStore = {
    makeSessionKey,
    load,
    loadWithRevision,
    save,
    saveWithCAS,
    clear,
    detectTopicChange,
    applyStateOverwriteWithTopicChange,
    appendHistory,
    buildDependencyGraph,
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
    pendingInteraction?: PendingInteraction
}
