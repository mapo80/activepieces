import * as nodeFs from 'node:fs'
import {
    Block,
    BubblePayload,
    EngineGenericError,
    FlowActionType,
    FlowRunStatus,
    GenericStepOutput,
    InteractiveFlowAction,
    InteractiveFlowActionSettings,
    InteractiveFlowBranchNode,
    InteractiveFlowConfirmNode,
    InteractiveFlowErrorPolicy,
    InteractiveFlowNode,
    InteractiveFlowNodeType,
    InteractiveFlowStateField,
    InteractiveFlowToolNode,
    InteractiveFlowUserInputNode,
    isNil,
    LocalizedString,
    NodeMessage,
    ParamBinding,
    PendingInteraction,
    RENDER_COMPONENT_CONFIRM_CARD,
    RENDER_COMPONENT_DATE_PICKER,
    ResolveMcpGatewayResponse,
    StepOutputStatus,
} from '@activepieces/shared'
import { workerSocket } from '../worker-socket'
import { BaseExecutor } from './base-executor'
import { EngineConstants } from './context/engine-constants'
import { FlowExecutorContext } from './context/flow-execution-context'
import { fieldExtractor, PolicyDecision } from './field-extractor'
import { interactiveFlowEvents } from './interactive-flow-events'
import { questionGenerator } from './question-generator'
import { DEFAULT_HISTORY_MAX_TURNS, HistoryEntry, sessionStore } from './session-store'
import { commandLayerClientAdapter } from './turn-interpreter-adapter'

// Debug logger: disabled by default, zero overhead when the env vars
// below are not set. Enable on-demand without editing this file:
//   AP_IF_DEBUG_LOG=/tmp/ap-if.log  → JSONL to that file (recommended)
//   AP_IF_DEBUG=true                → lines to engine stderr (best-effort;
//                                     engine stderr is only surfaced by
//                                     the worker on uncaughtException,
//                                     so the file mode is usually better)
const IF_DEBUG_PATH = process.env.AP_IF_DEBUG_LOG
const IF_DEBUG_ENABLED = (!isNilString(IF_DEBUG_PATH)) || process.env.AP_IF_DEBUG === 'true'
function ifDebug(stage: string, data: Record<string, unknown> = {}): void {
    if (!IF_DEBUG_ENABLED) return
    const line = JSON.stringify({ ts: new Date().toISOString(), stage, ...data }) + '\n'
    try {
        if (!isNilString(IF_DEBUG_PATH)) {
            nodeFs.appendFileSync(IF_DEBUG_PATH, line)
        }
        else {
            process.stderr.write(`[IF-DEBUG] ${line}`)
        }
    }
    catch { /* best-effort */ }
}
function isNilString(s: string | undefined): s is undefined {
    return s === undefined || s.length === 0
}

type InteractiveFlowState = Record<string, unknown>

type InteractiveFlowOutput = {
    state: InteractiveFlowState
    executedNodeIds: string[]
    skippedNodeIds?: string[]
    currentNodeId?: string
    failedNodeId?: string
    selectedBranches?: Record<string, string>
}

const DEFAULT_LOCALE = 'en'
const DEFAULT_TOOL_TIMEOUT_MS = 60_000

function isToolNode(node: InteractiveFlowNode): node is InteractiveFlowToolNode {
    return node.nodeType === InteractiveFlowNodeType.TOOL
}

function isUserInputNode(node: InteractiveFlowNode): node is InteractiveFlowUserInputNode {
    return node.nodeType === InteractiveFlowNodeType.USER_INPUT
}

function isConfirmNode(node: InteractiveFlowNode): node is InteractiveFlowConfirmNode {
    return node.nodeType === InteractiveFlowNodeType.CONFIRM
}

function isBranchNode(node: InteractiveFlowNode): node is InteractiveFlowBranchNode {
    return node.nodeType === InteractiveFlowNodeType.BRANCH
}

function resolveParamBinding({ binding, state }: {
    binding: ParamBinding
    state: InteractiveFlowState
}): unknown {
    switch (binding.kind) {
        case 'state':
            return state[binding.field]
        case 'literal':
            return binding.value
        case 'compose':
            return Object.fromEntries(binding.fields.map(f => [f, state[f]]))
    }
}

function buildToolParams({ node, state }: {
    node: InteractiveFlowToolNode
    state: InteractiveFlowState
}): Record<string, unknown> {
    if (isNil(node.toolParams)) {
        return {}
    }
    return Object.fromEntries(
        Object.entries(node.toolParams).map(([param, binding]) => [param, resolveParamBinding({ binding, state })]),
    )
}

function canonicalEnumKey(value: unknown): string {
    if (value === null || value === undefined) return ''
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    return JSON.stringify(value)
}

function coerceStateValue({ value, field }: {
    value: unknown
    field: InteractiveFlowStateField
}): unknown {
    if (isNil(value)) return value
    switch (field.type) {
        case 'string':
            return typeof value === 'string' ? value : String(value)
        case 'number': {
            if (typeof value === 'number') return value
            const n = Number(value)
            return Number.isFinite(n) ? n : value
        }
        case 'boolean':
            return Boolean(value)
        case 'array':
            return Array.isArray(value) ? value : [value]
        case 'object':
            if (typeof value === 'object') return value
            if (typeof value === 'string') {
                try {
                    return JSON.parse(value)
                }
                catch {
                    return value
                }
            }
            return value
        case 'date':
            return typeof value === 'string' ? value : String(value)
    }
}

function coerceIncomingState({ incoming, fields }: {
    incoming: Record<string, unknown>
    fields: InteractiveFlowStateField[]
}): Record<string, unknown> {
    const fieldsByName = new Map(fields.map(f => [f.name, f]))
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(incoming)) {
        const field = fieldsByName.get(key)
        out[key] = isNil(field) ? value : coerceStateValue({ value, field })
    }
    return out
}

function mapOutputsToState({ node, result, state, fields }: {
    node: InteractiveFlowToolNode
    result: unknown
    state: InteractiveFlowState
    fields: InteractiveFlowStateField[]
}): void {
    const fieldsByName = new Map(fields.map(f => [f.name, f]))
    const outputMap = node.outputMap ?? {}
    const resultObj = typeof result === 'object' && result !== null ? result as Record<string, unknown> : null
    if (node.stateOutputs.length === 1) {
        const target = node.stateOutputs[0]
        const source = outputMap[target]
        let value: unknown
        if (!isNil(source)) {
            value = resultObj ? resultObj[source] : result
        }
        else if (resultObj && target in resultObj) {
            value = resultObj[target]
        }
        else {
            value = result
        }
        const field = fieldsByName.get(target)
        state[target] = isNil(field) ? value : coerceStateValue({ value, field })
        return
    }
    if (isNil(resultObj)) return
    for (const target of node.stateOutputs) {
        const source = outputMap[target] ?? target
        if (source in resultObj) {
            const field = fieldsByName.get(target)
            const value = resultObj[source]
            state[target] = isNil(field) ? value : coerceStateValue({ value, field })
        }
    }
}

function redactSensitiveState({ state, fields }: {
    state: InteractiveFlowState
    fields: InteractiveFlowStateField[]
}): InteractiveFlowState {
    const sensitive = new Set(fields.filter(f => f.sensitive).map(f => f.name))
    if (sensitive.size === 0) return state
    const out: InteractiveFlowState = {}
    for (const [k, v] of Object.entries(state)) {
        if (!sensitive.has(k)) out[k] = v
    }
    return out
}

function resolveLocale({ constants, settings }: {
    constants: EngineConstants
    settings: InteractiveFlowActionSettings
}): string {
    const resumeLocale = (constants.resumePayload?.body as Record<string, unknown> | undefined)?.locale
    if (typeof resumeLocale === 'string' && resumeLocale.length > 0) return resumeLocale
    if (!isNil(settings.locale)) return settings.locale
    return DEFAULT_LOCALE
}

function resolveFlowLabel({ settings }: { settings: InteractiveFlowActionSettings }): string | undefined {
    if (!settings.flowLabel) return undefined
    const candidates = Object.values(settings.flowLabel)
    return candidates.length > 0 ? candidates[0] : undefined
}

function adaptTurnResultToExtractResult(result: { extractedFields: Record<string, unknown>, turnAffirmed: boolean, policyDecisions: unknown[], metaAnswer?: string, clarifyReason?: unknown }): { extractedFields: Record<string, unknown>, turnAffirmed: boolean, policyDecisions: PolicyDecision[], metaAnswer?: string, clarifyReason?: unknown } {
    return {
        extractedFields: result.extractedFields,
        turnAffirmed: result.turnAffirmed,
        policyDecisions: result.policyDecisions as PolicyDecision[],
        metaAnswer: result.metaAnswer,
        clarifyReason: result.clarifyReason,
    }
}

function resolveLocalizedString({ value, locale }: {
    value: LocalizedString | string | undefined
    locale: string
}): string | undefined {
    if (isNil(value)) return undefined
    if (typeof value === 'string') return value
    if (value[locale]) return value[locale]
    if (value[DEFAULT_LOCALE]) return value[DEFAULT_LOCALE]
    const firstKey = Object.keys(value)[0]
    return firstKey ? value[firstKey] : undefined
}

function resolveNodeMessage({ message, locale }: {
    message: NodeMessage | string | undefined
    locale: string
}): string | undefined {
    if (isNil(message)) return undefined
    if (typeof message === 'string') return message
    if (typeof message === 'object' && 'dynamic' in message && message.dynamic === true) {
        return resolveLocalizedString({ value: message.fallback, locale })
    }
    return resolveLocalizedString({ value: message as LocalizedString, locale })
}

async function resolveGateway({ gatewayId, constants }: {
    gatewayId: string
    constants: EngineConstants
}): Promise<ResolveMcpGatewayResponse> {
    const url = `${constants.internalApiUrl}v1/engine/mcp-gateways/${encodeURIComponent(gatewayId)}/resolve`
    let response: Response
    try {
        response = await fetch(url, {
            method: 'GET',
            headers: { Authorization: `Bearer ${constants.engineToken}` },
        })
    }
    catch (error) {
        throw new EngineGenericError('McpGatewayResolveFailed', `Could not reach the MCP gateway resolver: ${(error as Error).message}`)
    }
    if (!response.ok) {
        throw new EngineGenericError('McpGatewayResolveFailed', `MCP gateway resolver returned HTTP ${response.status}`)
    }
    return await response.json() as ResolveMcpGatewayResponse
}

async function executeToolWithPolicy({ node, params, gateway, policy }: {
    node: InteractiveFlowToolNode
    params: Record<string, unknown>
    gateway: ResolveMcpGatewayResponse
    policy: InteractiveFlowErrorPolicy | undefined
}): Promise<unknown> {
    const timeoutMs = policy?.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS
    const maxRetries = policy?.maxRetries ?? 0
    let lastError: Error | undefined
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        try {
            const response = await fetch(gateway.url, {
                method: 'POST',
                headers: gateway.headers,
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'tools/call',
                    params: { name: node.tool, arguments: params },
                }),
                signal: controller.signal,
            })
            clearTimeout(timer)
            if (!response.ok) {
                if (response.status >= 500 && attempt < maxRetries) {
                    lastError = new Error(`MCP tool call failed with status ${response.status}`)
                    await backoff(attempt)
                    continue
                }
                throw new EngineGenericError('McpToolCallFailed', `MCP tool call failed with status ${response.status}`)
            }
            const json = await response.json() as Record<string, unknown>
            const result = json.result as Record<string, unknown> | undefined
            const content = result?.content as Array<Record<string, unknown>> | undefined
            if (content?.[0]?.text && typeof content[0].text === 'string') {
                try {
                    return JSON.parse(content[0].text)
                }
                catch {
                    return content[0].text
                }
            }
            return result
        }
        catch (error) {
            clearTimeout(timer)
            lastError = error as Error
            if (attempt < maxRetries) {
                await backoff(attempt)
                continue
            }
            throw error
        }
    }
    throw lastError ?? new EngineGenericError('McpToolCallFailed', 'Tool call exhausted retries')
}

async function backoff(attempt: number): Promise<void> {
    const delayMs = Math.min(1000 * Math.pow(2, attempt), 10_000)
    await new Promise(resolve => setTimeout(resolve, delayMs))
}

function propagateSkip({ fromNodeId, nodes, skippedNodeIds }: {
    fromNodeId: string
    nodes: InteractiveFlowNode[]
    skippedNodeIds: Set<string>
}): void {
    skippedNodeIds.add(fromNodeId)
    const node = nodes.find(n => n.id === fromNodeId)
    if (!node) return
    const producedFields = isBranchNode(node) ? [] : node.stateOutputs
    for (const other of nodes) {
        if (other.id === fromNodeId) continue
        if (skippedNodeIds.has(other.id)) continue
        if (producedFields.some(f => other.stateInputs.includes(f))) {
            propagateSkip({ fromNodeId: other.id, nodes, skippedNodeIds })
        }
    }
}

function findReadyToolNodes({ nodes, state, executedNodeIds, skippedNodeIds }: {
    nodes: InteractiveFlowNode[]
    state: InteractiveFlowState
    executedNodeIds: Set<string>
    skippedNodeIds: Set<string>
}): InteractiveFlowToolNode[] {
    return nodes.filter((node): node is InteractiveFlowToolNode =>
        isToolNode(node) &&
        !executedNodeIds.has(node.id) &&
        !skippedNodeIds.has(node.id) &&
        node.stateInputs.every(field => !isNil(state[field])),
    )
}

function findReadyBranchNodes({ nodes, state, executedNodeIds, skippedNodeIds }: {
    nodes: InteractiveFlowNode[]
    state: InteractiveFlowState
    executedNodeIds: Set<string>
    skippedNodeIds: Set<string>
}): InteractiveFlowBranchNode[] {
    return nodes.filter((node): node is InteractiveFlowBranchNode =>
        isBranchNode(node) &&
        !executedNodeIds.has(node.id) &&
        !skippedNodeIds.has(node.id) &&
        node.stateInputs.every(field => !isNil(state[field])),
    )
}

function reValidateEnumFields({ flowState, fields, alreadyEmitted }: {
    flowState: InteractiveFlowState
    fields: InteractiveFlowStateField[]
    alreadyEmitted: Set<string>
}): { cleared: boolean, decisions: PolicyDecision[] } {
    const decisions: PolicyDecision[] = []
    for (const field of fields) {
        if (!field.enumFrom || !field.enumValueField) continue
        const value = flowState[field.name]
        if (isNil(value)) continue
        const catalog = flowState[field.enumFrom]
        if (!Array.isArray(catalog) || catalog.length === 0) continue
        const valueKey = field.enumValueField
        const allowed = catalog.map(item =>
            item && typeof item === 'object'
                ? (item as Record<string, unknown>)[valueKey]
                : undefined,
        )
        const normalizedValue = canonicalEnumKey(value)
        if (!allowed.some(v => canonicalEnumKey(v) === normalizedValue)) {
            const capturedValue = value
            Reflect.deleteProperty(flowState, field.name)
            if (field.extractable !== false) {
                const key = `${field.name}|${String(capturedValue).slice(0, 60)}`
                if (!alreadyEmitted.has(key)) {
                    alreadyEmitted.add(key)
                    decisions.push({
                        field: field.name,
                        action: 'reject',
                        reason: `not-in-state-${field.enumFrom}`,
                        value: capturedValue,
                    })
                }
            }
            ifDebug('handle:revalidate:cleared', {
                field: field.name,
                catalog: field.enumFrom,
                rejectedValue: String(capturedValue).slice(0, 40),
            })
        }
    }
    return { cleared: decisions.length > 0, decisions }
}

function findNextUserOrConfirmNode({ nodes, state, executedNodeIds, skippedNodeIds }: {
    nodes: InteractiveFlowNode[]
    state: InteractiveFlowState
    executedNodeIds: Set<string>
    skippedNodeIds: Set<string>
}): InteractiveFlowUserInputNode | InteractiveFlowConfirmNode | null {
    return (nodes.find((node): node is InteractiveFlowUserInputNode | InteractiveFlowConfirmNode =>
        (isUserInputNode(node) || isConfirmNode(node)) &&
        !executedNodeIds.has(node.id) &&
        !skippedNodeIds.has(node.id) &&
        node.stateInputs.every(field => !isNil(state[field])) &&
        node.stateOutputs.some(field => isNil(state[field])),
    )) ?? null
}

export function orderMissingByDependency({ missing, nodes }: {
    missing: string[]
    nodes: InteractiveFlowNode[]
}): string[] {
    const missingSet = new Set(missing)
    const hasUpstreamMissing = (field: string, visited: Set<string> = new Set()): boolean => {
        if (visited.has(field)) return false
        visited.add(field)
        for (const node of nodes) {
            if (!(node.stateOutputs ?? []).includes(field)) continue
            for (const inp of node.stateInputs ?? []) {
                if (missingSet.has(inp)) return true
                if (hasUpstreamMissing(inp, visited)) return true
            }
        }
        return false
    }
    const rootFields = missing.filter(f => !hasUpstreamMissing(f))
    if (rootFields.length === 0) return missing
    const firstNodeOrder = (field: string): number => {
        for (let i = 0; i < nodes.length; i++) {
            if ((nodes[i].stateOutputs ?? []).includes(field)) return i
        }
        return -1
    }
    return rootFields.slice().sort((a, b) => firstNodeOrder(a) - firstNodeOrder(b))
}

export function buildVirtualNodeAddendum({ primaryField, primaryLabel, primaryDesc, flowLabel, locale }: {
    primaryField: string
    primaryLabel: string
    primaryDesc: string | undefined
    flowLabel: string
    locale: string
}): string {
    const descParen = primaryDesc ? ` (${primaryDesc})` : ''
    if (locale.startsWith('it')) {
        return [
            'Sei all\'inizio della conversazione. L\'utente ha appena aperto la chat.',
            `Compito: presenta brevemente il servizio ("${flowLabel}") con tono professionale-bancario italiano e chiedi esclusivamente **${primaryLabel}**${descParen}.`,
            'NON saltare a campi successivi (es. date, motivazioni). NON chiedere più di un\'informazione.',
            'Formato: 2-3 frasi in italiano, cordiale ma sobrio, includi un esempio concreto se utile.',
            `Campo tecnico da raccogliere: \`${primaryField}\`.`,
        ].join(' ')
    }
    return [
        'Conversation just started. The user has just opened the chat.',
        `Task: briefly introduce the "${flowLabel}" task in a professional banking tone and ask only for **${primaryLabel}**${descParen}.`,
        'Do not skip ahead. Do not ask more than one piece of information.',
        `Format: 2-3 sentences, warm but concise, in ${locale}. Include a concrete example if useful.`,
        `Technical field: \`${primaryField}\`.`,
    ].join(' ')
}

function buildRejectionHint({ policyDecisions, stateFields, locale }: {
    policyDecisions: Array<{ field: string, action: string, reason?: string, value?: unknown }>
    stateFields: InteractiveFlowStateField[]
    locale: string
}): string | null {
    const rejections = policyDecisions.filter(d => d.action === 'reject' && d.reason)
    if (rejections.length === 0) return null
    const fieldsByName = new Map(stateFields.map(f => [f.name, f]))
    const labelFor = (field: string): string => {
        const def = fieldsByName.get(field)
        if (def?.label && typeof def.label === 'object') {
            return def.label[locale] ?? def.label.en ?? field
        }
        return field
    }
    const it = locale.startsWith('it')
    const lines: string[] = []
    for (const d of rejections) {
        const reason = String(d.reason ?? '')
        const label = labelFor(d.field)
        const raw = d.value !== undefined ? ` ("${String(d.value).slice(0, 60)}")` : ''
        let line: string
        if (reason === 'date-in-past') {
            line = it
                ? `La data${raw} è nel passato. Inserisci una data da oggi in poi (formato YYYY-MM-DD).`
                : `The date${raw} is in the past. Please provide a date from today onwards (YYYY-MM-DD).`
        }
        else if (reason === 'date-too-far') {
            line = it
                ? `La data${raw} è oltre i 5 anni consentiti. Indica una data entro 5 anni.`
                : `The date${raw} is beyond the allowed 5-year horizon.`
        }
        else if (reason === 'date-not-parseable' || reason === 'date-not-string') {
            line = it
                ? `Non ho compreso la data${raw}. Usa il formato YYYY-MM-DD o GG/MM/AAAA.`
                : `I didn't understand the date${raw}. Please use YYYY-MM-DD or DD/MM/YYYY.`
        }
        else if (reason === 'reason-not-resolved' || reason === 'ambiguous-reason-clarify') {
            line = it
                ? `Non ho riconosciuto la motivazione${raw}. Indicami il codice a 2 cifre dal catalogo.`
                : `I couldn't resolve the reason${raw}. Please provide the 2-digit code from the catalog.`
        }
        else if (reason.startsWith('plausibility-failed')) {
            line = it
                ? `Il valore fornito per ${label}${raw} non sembra valido. Riprova.`
                : `The value provided for ${label}${raw} looks invalid. Please try again.`
        }
        else if (reason === 'evidence-not-found' || reason.startsWith('evidence-')) {
            continue
        }
        else if (reason === 'explicit-user-reject' || reason.startsWith('field-not-admissible')) {
            continue
        }
        else if (reason.startsWith('not-in-state-')) {
            line = it
                ? `Il ${label}${raw} indicato non è tra le opzioni disponibili. Selezionane uno dall'elenco sottostante.`
                : `The ${label}${raw} provided is not among the available options. Please pick one from the list below.`
        }
        else {
            line = it
                ? `Il valore per ${label}${raw} è stato respinto (${reason}). Riprova.`
                : `The value for ${label}${raw} was rejected (${reason}). Please try again.`
        }
        lines.push(`- ${line}`)
    }
    if (lines.length === 0) return null
    const header = it ? 'Ho trovato un problema con l\'ultima risposta:' : 'There is an issue with the previous answer:'
    return `${header}\n${lines.join('\n')}`
}

function stripMarkdownTable(text: string): string {
    // Remove markdown GFM tables (header + separator + body rows) — they are
    // redundant when we also emit a structured data-list block.
    const withoutTables = text.replace(/\n?\|[^\n]*\|\n\|[-:\s|]+\|(\n\|[^\n]*\|)+/g, '')
    return withoutTables.replace(/\n{3,}/g, '\n\n').trim()
}

function buildPauseBody({ message, pendingInteraction, node, state, locale }: {
    message: string
    pendingInteraction: PendingInteraction | null
    node: InteractiveFlowUserInputNode | InteractiveFlowConfirmNode
    state: InteractiveFlowState
    locale?: string
}): BubblePayload {
    if (isUserInputNode(node) && node.render?.component === RENDER_COMPONENT_DATE_PICKER) {
        const renderProps = (node.render?.props ?? {}) as Record<string, unknown>
        const rawFormat = typeof renderProps.format === 'string' ? renderProps.format : 'YYYY-MM-DD'
        const format: 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'ISO' =
            rawFormat === 'DD/MM/YYYY' || rawFormat === 'ISO' ? rawFormat : 'YYYY-MM-DD'
        const minDate = typeof renderProps.minDate === 'string' ? renderProps.minDate : undefined
        const maxDate = typeof renderProps.maxDate === 'string' ? renderProps.maxDate : undefined
        const title = typeof renderProps.title === 'string' ? renderProps.title : undefined
        const blocks: Block[] = []
        const cleanedMessage = message.trim()
        if (cleanedMessage.length > 0) blocks.push({ type: 'text', value: cleanedMessage })
        blocks.push({
            type: 'date-picker',
            format,
            minDate,
            maxDate,
            locale: locale ?? 'it',
            title,
        })
        return { type: 'blocks-v1', blocks }
    }
    if (isConfirmNode(node) && node.render?.component === RENDER_COMPONENT_CONFIRM_CARD) {
        const renderProps = (node.render?.props ?? {}) as Record<string, unknown>
        const sourceField = typeof renderProps.sourceField === 'string' ? renderProps.sourceField : undefined
        const base64 = sourceField ? String(state[sourceField] ?? '') : ''
        const blocks: Block[] = []
        const cleanedMessage = message.trim()
        if (cleanedMessage.length > 0) blocks.push({ type: 'text', value: cleanedMessage })
        if (base64.length > 0) {
            blocks.push({
                type: 'pdf-viewer',
                base64,
                fileName: 'modulo-estinzione.pdf',
                title: 'Modulo di richiesta',
            })
        }
        blocks.push({
            type: 'quick-replies',
            replies: [
                { label: 'Confermo invio', payload: 'sì confermo invio', style: 'primary' },
                { label: 'Annulla', payload: 'no annulla', style: 'default' },
            ],
        })
        return { type: 'blocks-v1', blocks }
    }
    if (pendingInteraction?.type === 'pick_from_list' && pendingInteraction.options.length > 0) {
        const renderProps = (node.render?.props ?? {}) as Record<string, unknown>
        const sourceField = typeof renderProps.sourceField === 'string' ? renderProps.sourceField : undefined
        const sourceArray = sourceField && Array.isArray(state[sourceField])
            ? state[sourceField] as Array<Record<string, unknown>>
            : []
        const columns = Array.isArray(renderProps.columns)
            ? renderProps.columns as Array<{ key: string, header: string, align?: 'left' | 'right' | 'center' }>
            : []
        const requestedLayout = renderProps.layout === 'table' ? 'table' : 'cards'
        const strategy = isUserInputNode(node) ? (node.singleOptionStrategy ?? 'confirm') : 'confirm'
        const singleConfirmActive = pendingInteraction.options.length === 1 && strategy === 'confirm'
        const layout: 'cards' | 'table' | 'single-confirm' =
            singleConfirmActive ? 'single-confirm'
                : requestedLayout === 'table' && columns.length > 0 ? 'table'
                    : 'cards'
        const primaryKey = columns[0]?.key
        const titleKey = columns[1]?.key
        const subtitleKey = columns[2]?.key
        const items = pendingInteraction.options.map((opt) => {
            const valueStr = String(opt.value)
            const row = sourceArray.find(r => primaryKey && String(r[primaryKey]) === valueStr)
            if (layout === 'table') {
                const fields: Record<string, string> = {}
                for (const col of columns) {
                    const raw = row?.[col.key]
                    fields[col.key] = raw == null ? '' : String(raw)
                }
                return { primary: valueStr, payload: valueStr, fields }
            }
            const title = row && titleKey ? String(row[titleKey] ?? opt.label) : opt.label
            const subtitle = row && subtitleKey ? String(row[subtitleKey] ?? '') : undefined
            return {
                primary: valueStr,
                title,
                subtitle: subtitle || undefined,
                payload: valueStr,
            }
        })
        const dataList: Block = layout === 'table'
            ? { type: 'data-list', selectMode: 'single', layout, columns, items }
            : { type: 'data-list', selectMode: 'single', layout, items }
        const blocks: Block[] = []
        const cleanedMessage = stripMarkdownTable(message)
        if (cleanedMessage.trim().length > 0) blocks.push({ type: 'text', value: cleanedMessage })
        blocks.push(dataList)
        return { type: 'blocks-v1', blocks }
    }
    return { type: 'markdown', value: message, files: [] }
}

function pendingOverwriteFromPolicyDecisions({ policyDecisions, nodeId }: {
    policyDecisions: Array<{ field: string, action: string, reason?: string, pendingOverwrite?: { field: string, oldValue: unknown, newValue: unknown } }>
    nodeId: string
}): PendingInteraction | null {
    for (const dec of policyDecisions) {
        if (dec.action === 'confirm' && dec.pendingOverwrite) {
            return {
                type: 'pending_overwrite',
                field: dec.pendingOverwrite.field,
                oldValue: dec.pendingOverwrite.oldValue,
                newValue: dec.pendingOverwrite.newValue,
                nodeId,
            }
        }
    }
    return null
}

function renderPendingOverwriteBubble({ pending }: { pending: PendingInteraction }): string {
    if (pending.type !== 'pending_overwrite') return ''
    const fmt = (v: unknown): string => {
        if (v === null || v === undefined) return ''
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
        return JSON.stringify(v)
    }
    return [
        `Ho capito che ora vuoi cambiare **${pending.field}** da **${fmt(pending.oldValue)}** a **${fmt(pending.newValue)}**.`,
        '',
        'Confermi il cambiamento? Rispondi **sì** per applicare o **no** per mantenere il valore precedente.',
    ].join('\n')
}

function computePendingInteraction({ node, state }: {
    node: InteractiveFlowUserInputNode | InteractiveFlowConfirmNode
    state: InteractiveFlowState
}): PendingInteraction | null {
    const targetField = node.stateOutputs.find(f => isNil(state[f])) ?? node.stateOutputs[0]
    if (isNil(targetField)) return null

    if (isConfirmNode(node)) {
        return {
            type: 'confirm_binary',
            field: targetField,
            target: true,
            nodeId: node.id,
        }
    }

    const renderProps = (node.render?.props ?? {}) as Record<string, unknown>
    const sourceField = typeof renderProps.sourceField === 'string' ? renderProps.sourceField : undefined
    if (!isNil(sourceField) && Array.isArray(state[sourceField])) {
        const raw = state[sourceField] as unknown[]
        if (raw.length > 0) {
            const columns = Array.isArray(renderProps.columns)
                ? renderProps.columns as Array<{ key: string, header?: string }>
                : []
            const primaryKey = typeof renderProps.valueKey === 'string'
                ? renderProps.valueKey
                : (typeof renderProps.optionValueField === 'string' ? renderProps.optionValueField : columns[0]?.key)
            const labelKey = typeof renderProps.optionLabelField === 'string'
                ? renderProps.optionLabelField
                : columns[1]?.key
            const options = raw.map((item, idx) => {
                const rec = (item ?? {}) as Record<string, unknown>
                const value = primaryKey
                    ? rec[primaryKey] ?? rec.id ?? rec.ndg ?? rec.codice ?? item
                    : rec.id ?? rec.ndg ?? rec.codice ?? rec.code ?? item
                const label = String(
                    (labelKey ? rec[labelKey] : undefined)
                    ?? rec.name ?? rec.label ?? rec.descrizione ?? rec.denominazione ?? rec.tipo ?? String(value),
                )
                return { ordinal: idx + 1, label, value }
            })
            return {
                type: 'pick_from_list',
                field: targetField,
                options,
                nodeId: node.id,
            }
        }
    }

    return {
        type: 'open_text',
        field: targetField,
        nodeId: node.id,
    }
}

function evaluateBranchSimply({ branch, state }: {
    branch: InteractiveFlowBranchNode['branches'][number]
    state: InteractiveFlowState
}): boolean {
    if (branch.branchType === 'FALLBACK') return true
    // Minimal evaluator for v1: check each condition group (OR across groups, AND inside each group).
    // Supports TEXT_EXACTLY_MATCHES, NUMBER_IS_EQUAL_TO, BOOLEAN_IS_TRUE/FALSE, EXISTS/DOES_NOT_EXIST as a baseline.
    // Full evaluator parity with ROUTER's evaluateConditions lives in a follow-up alongside richer condition UI.
    for (const group of branch.conditions) {
        const allMatch = group.every((raw) => {
            const condition = raw as { operator?: string, firstValue?: unknown, secondValue?: unknown }
            const op = condition.operator ?? 'TEXT_EXACTLY_MATCHES'
            const fv = substituteTemplate(condition.firstValue, state)
            const sv = substituteTemplate(condition.secondValue, state)
            switch (op) {
                case 'TEXT_EXACTLY_MATCHES':
                    return String(fv) === String(sv)
                case 'TEXT_DOES_NOT_EXACTLY_MATCH':
                    return String(fv) !== String(sv)
                case 'TEXT_CONTAINS':
                    return String(fv).includes(String(sv))
                case 'NUMBER_IS_EQUAL_TO':
                    return Number(fv) === Number(sv)
                case 'NUMBER_IS_GREATER_THAN':
                    return Number(fv) > Number(sv)
                case 'NUMBER_IS_LESS_THAN':
                    return Number(fv) < Number(sv)
                case 'BOOLEAN_IS_TRUE':
                    return Boolean(fv) === true
                case 'BOOLEAN_IS_FALSE':
                    return Boolean(fv) === false
                case 'EXISTS':
                    return !isNil(fv) && fv !== ''
                case 'DOES_NOT_EXIST':
                    return isNil(fv) || fv === ''
                default:
                    return false
            }
        })
        if (allMatch) return true
    }
    return false
}

function substituteTemplate(raw: unknown, state: InteractiveFlowState): unknown {
    if (typeof raw !== 'string') return raw
    return raw.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_, key: string) => {
        const v = state[key]
        return typeof v === 'string' ? v : JSON.stringify(v)
    })
}

function resolveMessageInputFromTrigger({ template, triggerPayload }: {
    template: string
    triggerPayload: Record<string, unknown> | undefined
}): string | undefined {
    if (isNil(triggerPayload)) return undefined
    // Minimal AP expression resolver: supports dotted paths such as
    // `{{trigger.body.message}}` or `{{trigger.body.someField}}`. Only
    // reads from `triggerPayload`; anything else is left unchanged so
    // that a bogus template fails loud (empty string) rather than
    // silently swallowing the extractor call.
    const replaced = template.replace(
        /\{\{\s*trigger\.([a-zA-Z0-9_.]+)\s*\}\}/g,
        (_, path: string) => {
            const parts = path.split('.')
            let cur: unknown = triggerPayload
            for (const part of parts) {
                if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
                    cur = (cur as Record<string, unknown>)[part]
                }
                else {
                    return ''
                }
            }
            if (typeof cur === 'string') return cur
            if (isNil(cur)) return ''
            return JSON.stringify(cur)
        },
    )
    return replaced.length > 0 ? replaced : undefined
}

function applyBranch({ node, state, nodes, executedNodeIds, skippedNodeIds, selectedBranches }: {
    node: InteractiveFlowBranchNode
    state: InteractiveFlowState
    nodes: InteractiveFlowNode[]
    executedNodeIds: Set<string>
    skippedNodeIds: Set<string>
    selectedBranches: Record<string, string>
}): void {
    let selected = node.branches.find(b => b.branchType !== 'FALLBACK' && evaluateBranchSimply({ branch: b, state }))
    if (isNil(selected)) {
        selected = node.branches.find(b => b.branchType === 'FALLBACK')
    }
    if (isNil(selected)) {
        propagateSkip({ fromNodeId: node.id, nodes, skippedNodeIds })
        return
    }
    selectedBranches[node.id] = selected.id
    const reachableNodeIds = new Set(selected.targetNodeIds)
    // Nodes that are targets of a non-selected branch but not the selected one → skipped
    for (const branch of node.branches) {
        if (branch.id === selected.id) continue
        for (const target of branch.targetNodeIds) {
            if (!reachableNodeIds.has(target)) {
                propagateSkip({ fromNodeId: target, nodes, skippedNodeIds })
            }
        }
    }
    executedNodeIds.add(node.id)
}

function isAlreadyWritten({ node, state }: {
    node: InteractiveFlowNode
    state: InteractiveFlowState
}): boolean {
    if (node.stateOutputs.length === 0) return false
    return node.stateOutputs.every(f => !isNil(state[f]))
}

export const interactiveFlowExecutor: BaseExecutor<InteractiveFlowAction> = {
    async handle({ action, executionState, constants }: {
        action: InteractiveFlowAction
        executionState: FlowExecutorContext
        constants: EngineConstants
    }): Promise<FlowExecutorContext> {
        ifDebug('handle:enter', {
            actionName: action.name,
            flowRunId: constants.flowRunId,
            isCompleted: executionState.isCompleted({ stepName: action.name }),
            hasResumeBody: !isNil(constants.resumePayload?.body),
            hasHttpRequestId: !isNil(constants.httpRequestId),
        })
        if (executionState.isCompleted({ stepName: action.name })) {
            ifDebug('handle:already-completed')
            return executionState
        }

        const { settings } = action
        const nodes = settings.nodes
        const fields = settings.stateFields

        if (nodes.length === 0) {
            const stepOutput = GenericStepOutput.create({
                type: FlowActionType.INTERACTIVE_FLOW,
                status: StepOutputStatus.SUCCEEDED,
                input: {},
                output: { state: {}, executedNodeIds: [] },
            })
            return executionState.upsertStep(action.name, stepOutput)
        }

        const previousOutput = executionState.getStepOutput(action.name)
        const prevFlowOutput = previousOutput?.output as InteractiveFlowOutput | undefined
        const flowState: InteractiveFlowState = { ...(prevFlowOutput?.state ?? {}) }
        const executedNodeIds = new Set<string>(prevFlowOutput?.executedNodeIds ?? [])
        const skippedNodeIds = new Set<string>(prevFlowOutput?.skippedNodeIds ?? [])
        const selectedBranches: Record<string, string> = { ...(prevFlowOutput?.selectedBranches ?? {}) }

        const triggerStep = executionState.getStepOutput('trigger')
        const triggerOutput = triggerStep?.output as Record<string, unknown> | undefined
        const sessionId = !isNil(settings.sessionIdInput)
            ? resolveMessageInputFromTrigger({ template: settings.sessionIdInput, triggerPayload: triggerOutput })
            : undefined
        const sessionKey = !isNil(sessionId) && sessionId.trim().length > 0
            ? sessionStore.makeSessionKey({
                actionName: action.name,
                sessionNamespace: settings.sessionNamespace,
                sessionId,
            })
            : undefined
        const historyMaxTurns = settings.historyMaxTurns ?? DEFAULT_HISTORY_MAX_TURNS
        let history: HistoryEntry[] = []
        let previousPendingInteraction: PendingInteraction | null = null
        let pendingOverwriteSignal: PendingInteraction | null = null
        let rejectionHint: string | null = null
        let lastExtractionDecisions: PolicyDecision[] = []
        const postValidationDecisions: PolicyDecision[] = []
        const emittedRevalidationKeys = new Set<string>()

        let gateway: ResolveMcpGatewayResponse | null = null
        const ensureGateway = async (): Promise<ResolveMcpGatewayResponse> => {
            if (!isNil(gateway)) return gateway
            if (isNil(settings.mcpGatewayId)) {
                throw new EngineGenericError('McpGatewayNotConfigured', 'No MCP gateway selected in the interactive flow settings')
            }
            gateway = await resolveGateway({ gatewayId: settings.mcpGatewayId, constants })
            return gateway
        }

        if (!isNil(sessionKey)) {
            try {
                const loaded = await sessionStore.load({
                    key: sessionKey,
                    constants,
                    currentFlowVersionId: constants.flowVersionId,
                })
                if (!isNil(loaded.record) && !loaded.versionMismatch) {
                    if (isNil(prevFlowOutput)) {
                        for (const [k, v] of Object.entries(loaded.record.state)) {
                            flowState[k] = v
                        }
                    }
                    history = [...loaded.record.history]
                    previousPendingInteraction = loaded.record.pendingInteraction ?? null
                    ifDebug('handle:session:loaded', {
                        sessionId,
                        stateKeys: Object.keys(loaded.record.state),
                        historyLen: loaded.record.history.length,
                        pendingInteractionType: previousPendingInteraction?.type ?? null,
                    })
                }
                else if (!isNil(loaded.record) && loaded.versionMismatch) {
                    ifDebug('handle:session:version-reset', {
                        was: loaded.record.flowVersionId,
                        now: constants.flowVersionId,
                    })
                }
                else {
                    ifDebug('handle:session:miss', { sessionId })
                }
            }
            catch (e) {
                ifDebug('handle:session:load-error', { error: (e as Error).message })
            }
        }

        if (constants.resumePayload?.body && typeof constants.resumePayload.body === 'object') {
            const incoming = constants.resumePayload.body as Record<string, unknown>
            const coerced = coerceIncomingState({ incoming, fields })
            for (const [k, v] of Object.entries(coerced)) {
                if (k === 'locale' || k === 'message') continue
                flowState[k] = v
            }

            const userMessage = typeof incoming.message === 'string' ? incoming.message : undefined
            if (!isNil(userMessage)) {
                history = sessionStore.appendHistory({ history, role: 'user', text: userMessage, historyMaxTurns })
            }
            ifDebug('handle:resume:incoming', {
                incomingKeys: Object.keys(incoming),
                userMessagePreview: userMessage?.slice(0, 80),
            })
            if (!isNil(userMessage) && !isNil(settings.fieldExtractor)) {
                const pauseHint = findNextUserOrConfirmNode({ nodes, state: flowState, executedNodeIds, skippedNodeIds })
                const extractResult = settings.useCommandLayer === true
                    ? adaptTurnResultToExtractResult(await commandLayerClientAdapter.interpret({
                        constants,
                        message: userMessage,
                        systemPrompt: settings.systemPrompt,
                        locale: resolveLocale({ constants, settings }),
                        flowLabel: resolveFlowLabel({ settings }),
                        state: flowState,
                        history,
                        stateFields: fields,
                        nodes,
                        currentNode: pauseHint ? {
                            nodeId: pauseHint.id,
                            nodeType: pauseHint.nodeType === 'CONFIRM' ? 'CONFIRM' : 'USER_INPUT',
                            displayName: pauseHint.displayName,
                            stateOutputs: pauseHint.stateOutputs,
                            allowedExtraFields: pauseHint.allowedExtraFields,
                        } : null,
                        pendingInteraction: previousPendingInteraction ?? null,
                        identityFields: ['customerName'],
                        infoIntents: settings.infoIntents ?? [],
                        sessionId: sessionId ?? '__noop__',
                        sessionRevision: 0,
                        flowVersionId: constants.flowVersionId,
                    }))
                    : await fieldExtractor.extractWithPolicy({
                        constants,
                        config: settings.fieldExtractor,
                        message: userMessage,
                        stateFields: fields,
                        currentState: flowState,
                        systemPrompt: settings.systemPrompt,
                        locale: resolveLocale({ constants, settings }),
                        currentNode: pauseHint ? {
                            nodeId: pauseHint.id,
                            nodeType: pauseHint.nodeType === 'CONFIRM' ? 'CONFIRM' : 'USER_INPUT',
                            displayName: pauseHint.displayName,
                            stateOutputs: pauseHint.stateOutputs,
                            allowedExtraFields: pauseHint.allowedExtraFields,
                        } : undefined,
                        identityFields: ['customerName'],
                        pendingInteraction: previousPendingInteraction ?? undefined,
                    })
                pendingOverwriteSignal = pendingOverwriteFromPolicyDecisions({
                    policyDecisions: extractResult.policyDecisions,
                    nodeId: pauseHint?.id ?? '__pending_overwrite__',
                }) ?? null
                lastExtractionDecisions = extractResult.policyDecisions
                rejectionHint = buildRejectionHint({
                    policyDecisions: extractResult.policyDecisions,
                    stateFields: fields,
                    locale: resolveLocale({ constants, settings }),
                })
                ifDebug('handle:resume:extracted', {
                    extractedKeys: Object.keys(extractResult.extractedFields),
                    turnAffirmed: extractResult.turnAffirmed,
                    pendingOverwriteSignal: pendingOverwriteSignal?.type ?? null,
                    hasRejectionHint: !isNil(rejectionHint),
                })
                const coercedExtracted = coerceIncomingState({ incoming: extractResult.extractedFields, fields })
                const applied = sessionStore.applyStateOverwriteWithTopicChange({
                    flowState,
                    incoming: coercedExtracted,
                    fields,
                    nodes,
                })
                if (applied.topicChanged) {
                    for (const stale of applied.clearedKeys) {
                        for (const nodeId of Array.from(executedNodeIds)) {
                            const executedNode = nodes.find(n => n.id === nodeId)
                            if (executedNode && (executedNode.stateOutputs ?? []).includes(stale)) {
                                executedNodeIds.delete(nodeId)
                            }
                        }
                        for (const nodeId of Array.from(skippedNodeIds)) {
                            const skippedNode = nodes.find(n => n.id === nodeId)
                            if (skippedNode && (skippedNode.stateOutputs ?? []).includes(stale)) {
                                skippedNodeIds.delete(nodeId)
                            }
                        }
                    }
                    ifDebug('handle:session:topic-change', { stateKeys: Object.keys(flowState), clearedKeys: applied.clearedKeys })
                }
            }
        }
        else if (
            isNil(prevFlowOutput)
            && !isNil(settings.messageInput)
            && !isNil(settings.fieldExtractor)
        ) {
            const userMessage = resolveMessageInputFromTrigger({
                template: settings.messageInput,
                triggerPayload: triggerOutput,
            })
            ifDebug('handle:first-turn:begin', {
                template: settings.messageInput,
                triggerOutputKeys: triggerOutput ? Object.keys(triggerOutput) : null,
                userMessagePreview: userMessage?.slice(0, 80),
            })
            if (!isNil(userMessage) && userMessage.trim().length > 0) {
                history = sessionStore.appendHistory({ history, role: 'user', text: userMessage, historyMaxTurns })
                // Pre-run truly-stateless catalog tools (stateInputs === [])
                // so enum-backed fields (closureReasonCode, closureReasonText)
                // can be validated and resolved during first-turn extraction.
                // Tools with non-empty stateInputs are deferred to the main
                // while(changed) loop so they don't fire for resumed sessions.
                const preExtractTools = nodes.filter((n): n is InteractiveFlowToolNode =>
                    isToolNode(n)
                    && (n.stateInputs ?? []).length === 0
                    && !executedNodeIds.has(n.id)
                    && !skippedNodeIds.has(n.id),
                )
                for (const preTool of preExtractTools) {
                    try {
                        const params = buildToolParams({ node: preTool, state: flowState })
                        const resolvedGateway = await ensureGateway()
                        const result = await executeToolWithPolicy({ node: preTool, params, gateway: resolvedGateway, policy: preTool.errorPolicy })
                        mapOutputsToState({ node: preTool, result, state: flowState, fields })
                        executedNodeIds.add(preTool.id)
                        ifDebug('handle:first-turn:pre-tool', { nodeId: preTool.id, outputs: preTool.stateOutputs })
                    }
                    catch (e) {
                        ifDebug('handle:first-turn:pre-tool-error', { nodeId: preTool.id, error: (e as Error).message?.slice(0, 120) })
                    }
                }
                try {
                    const pauseHint = findNextUserOrConfirmNode({ nodes, state: flowState, executedNodeIds, skippedNodeIds })
                    const extractResult = settings.useCommandLayer === true
                        ? adaptTurnResultToExtractResult(await commandLayerClientAdapter.interpret({
                            constants,
                            message: userMessage,
                            systemPrompt: settings.systemPrompt,
                            locale: resolveLocale({ constants, settings }),
                            flowLabel: resolveFlowLabel({ settings }),
                            state: flowState,
                            history,
                            stateFields: fields,
                            nodes,
                            currentNode: pauseHint ? {
                                nodeId: pauseHint.id,
                                nodeType: pauseHint.nodeType === 'CONFIRM' ? 'CONFIRM' : 'USER_INPUT',
                                displayName: pauseHint.displayName,
                                stateOutputs: pauseHint.stateOutputs,
                                allowedExtraFields: pauseHint.allowedExtraFields,
                            } : null,
                            pendingInteraction: previousPendingInteraction ?? null,
                            identityFields: ['customerName'],
                            infoIntents: settings.infoIntents ?? [],
                            sessionId: sessionId ?? '__noop__',
                            sessionRevision: 0,
                            flowVersionId: constants.flowVersionId,
                        }))
                        : await fieldExtractor.extractWithPolicy({
                            constants,
                            config: settings.fieldExtractor,
                            message: userMessage,
                            stateFields: fields,
                            currentState: flowState,
                            systemPrompt: settings.systemPrompt,
                            locale: resolveLocale({ constants, settings }),
                            currentNode: pauseHint ? {
                                nodeId: pauseHint.id,
                                nodeType: pauseHint.nodeType === 'CONFIRM' ? 'CONFIRM' : 'USER_INPUT',
                                displayName: pauseHint.displayName,
                                stateOutputs: pauseHint.stateOutputs,
                                allowedExtraFields: pauseHint.allowedExtraFields,
                            } : undefined,
                            identityFields: ['customerName'],
                            pendingInteraction: previousPendingInteraction ?? undefined,
                        })
                    pendingOverwriteSignal = pendingOverwriteFromPolicyDecisions({
                        policyDecisions: extractResult.policyDecisions,
                        nodeId: pauseHint?.id ?? '__pending_overwrite__',
                    }) ?? null
                    lastExtractionDecisions = extractResult.policyDecisions
                    rejectionHint = buildRejectionHint({
                        policyDecisions: extractResult.policyDecisions,
                        stateFields: fields,
                        locale: resolveLocale({ constants, settings }),
                    })
                    ifDebug('handle:first-turn:extracted', {
                        extractedKeys: Object.keys(extractResult.extractedFields),
                        turnAffirmed: extractResult.turnAffirmed,
                        pendingOverwriteSignal: pendingOverwriteSignal?.type ?? null,
                        hasRejectionHint: !isNil(rejectionHint),
                    })
                    const coercedExtracted = coerceIncomingState({ incoming: extractResult.extractedFields, fields })
                    const applied = sessionStore.applyStateOverwriteWithTopicChange({
                        flowState,
                        incoming: coercedExtracted,
                        fields,
                        nodes,
                    })
                    if (applied.topicChanged) {
                        for (const stale of applied.clearedKeys) {
                            for (const nodeId of Array.from(executedNodeIds)) {
                                const executedNode = nodes.find(n => n.id === nodeId)
                                if (executedNode && (executedNode.stateOutputs ?? []).includes(stale)) {
                                    executedNodeIds.delete(nodeId)
                                }
                            }
                            for (const nodeId of Array.from(skippedNodeIds)) {
                                const skippedNode = nodes.find(n => n.id === nodeId)
                                if (skippedNode && (skippedNode.stateOutputs ?? []).includes(stale)) {
                                    skippedNodeIds.delete(nodeId)
                                }
                            }
                        }
                        ifDebug('handle:session:topic-change', { stateKeys: Object.keys(flowState), clearedKeys: applied.clearedKeys })
                    }
                }
                catch (e) {
                    ifDebug('handle:first-turn:error', { error: (e as Error).message })
                    throw e
                }
            }
        }

        const persistSession = async (opts: { botMessage?: string, terminal?: boolean, pendingInteraction?: PendingInteraction | null }): Promise<void> => {
            if (isNil(sessionKey)) return
            try {
                const withBot = !isNil(opts.botMessage) && opts.botMessage.trim().length > 0
                    ? sessionStore.appendHistory({ history, role: 'assistant', text: opts.botMessage, historyMaxTurns })
                    : history
                history = withBot
                if (opts.terminal === true && (settings.cleanupOnSuccess ?? true)) {
                    await sessionStore.clear({ key: sessionKey, constants })
                    ifDebug('handle:session:cleared', { sessionId })
                    return
                }
                const saved = await sessionStore.save({
                    key: sessionKey,
                    constants,
                    state: flowState,
                    history: withBot,
                    flowVersionId: constants.flowVersionId,
                    historyMaxTurns,
                    pendingInteraction: opts.pendingInteraction ?? null,
                })
                ifDebug('handle:session:saved', {
                    sessionId,
                    bytes: saved.bytes,
                    historyLen: withBot.length,
                    truncated: saved.truncated,
                    pendingInteractionType: opts.pendingInteraction?.type ?? null,
                })
            }
            catch (e) {
                ifDebug('handle:session:save-error', { error: (e as Error).message })
            }
        }

        if (!isNil(pendingOverwriteSignal)) {
            const overwriteBubble = renderPendingOverwriteBubble({ pending: pendingOverwriteSignal })
            ifDebug('handle:pending-overwrite:emit', {
                field: pendingOverwriteSignal.field,
                nodeId: pendingOverwriteSignal.nodeId,
            })
            if (!isNil(constants.workerHandlerId) && !isNil(constants.httpRequestId)) {
                try {
                    await workerSocket.getWorkerClient().sendFlowResponse({
                        workerHandlerId: constants.workerHandlerId,
                        httpRequestId: constants.httpRequestId,
                        runResponse: {
                            status: 200,
                            body: { type: 'markdown', value: overwriteBubble, files: [] },
                            headers: {},
                        },
                    })
                }
                catch (e) {
                    ifDebug('handle:pending-overwrite:sendFlowResponse:error', { error: (e as Error).message })
                }
            }
            await persistSession({ botMessage: overwriteBubble, pendingInteraction: pendingOverwriteSignal })
            const overwriteStepOutput = GenericStepOutput.create({
                type: FlowActionType.INTERACTIVE_FLOW,
                status: StepOutputStatus.SUCCEEDED,
                input: {},
                output: {
                    state: flowState,
                    executedNodeIds: Array.from(executedNodeIds),
                    skippedNodeIds: Array.from(skippedNodeIds),
                    selectedBranches,
                },
            })
            return executionState.upsertStep(action.name, overwriteStepOutput)
        }

        // Nodes with outputs already satisfied = already executed (e.g. field extractor pre-filled them)
        for (const node of nodes) {
            if (executedNodeIds.has(node.id) || skippedNodeIds.has(node.id)) continue
            if (!isBranchNode(node) && isAlreadyWritten({ node, state: flowState })) {
                executedNodeIds.add(node.id)
            }
        }

        let changed = true
        while (changed) {
            changed = false

            for (const branchNode of findReadyBranchNodes({ nodes, state: flowState, executedNodeIds, skippedNodeIds })) {
                const beforeSkipped = new Set(skippedNodeIds)
                applyBranch({
                    node: branchNode,
                    state: flowState,
                    nodes,
                    executedNodeIds,
                    skippedNodeIds,
                    selectedBranches,
                })
                await interactiveFlowEvents.emit({
                    constants,
                    event: {
                        stepName: action.name,
                        nodeId: branchNode.id,
                        kind: 'BRANCH_SELECTED',
                        branchId: selectedBranches[branchNode.id],
                    },
                })
                for (const id of skippedNodeIds) {
                    if (!beforeSkipped.has(id)) {
                        await interactiveFlowEvents.emit({
                            constants,
                            event: { stepName: action.name, nodeId: id, kind: 'SKIPPED' },
                        })
                    }
                }
                changed = true
            }

            const readyTools = findReadyToolNodes({ nodes, state: flowState, executedNodeIds, skippedNodeIds })
            for (const node of readyTools) {
                const r1 = reValidateEnumFields({ flowState, fields, alreadyEmitted: emittedRevalidationKeys })
                if (r1.cleared) {
                    changed = true
                    postValidationDecisions.push(...r1.decisions)
                }
                if (!node.stateInputs.every(f => !isNil(flowState[f]))) continue

                const policy = node.errorPolicy
                await interactiveFlowEvents.emit({
                    constants,
                    event: { stepName: action.name, nodeId: node.id, kind: 'STARTED' },
                })
                try {
                    const params = buildToolParams({ node, state: flowState })
                    const resolvedGateway = await ensureGateway()
                    const result = await executeToolWithPolicy({ node, params, gateway: resolvedGateway, policy })
                    mapOutputsToState({ node, result, state: flowState, fields })
                    executedNodeIds.add(node.id)
                    await interactiveFlowEvents.emit({
                        constants,
                        event: { stepName: action.name, nodeId: node.id, kind: 'COMPLETED' },
                    })
                }
                catch (error) {
                    const onFailure = policy?.onFailure ?? 'FAIL'
                    if (onFailure === 'SKIP') {
                        const beforeSkipped = new Set(skippedNodeIds)
                        propagateSkip({ fromNodeId: node.id, nodes, skippedNodeIds })
                        for (const id of skippedNodeIds) {
                            if (!beforeSkipped.has(id)) {
                                await interactiveFlowEvents.emit({
                                    constants,
                                    event: { stepName: action.name, nodeId: id, kind: 'SKIPPED' },
                                })
                            }
                        }
                    }
                    else if (onFailure === 'CONTINUE') {
                        executedNodeIds.add(node.id)
                        await interactiveFlowEvents.emit({
                            constants,
                            event: { stepName: action.name, nodeId: node.id, kind: 'COMPLETED' },
                        })
                    }
                    else {
                        await interactiveFlowEvents.emit({
                            constants,
                            event: {
                                stepName: action.name,
                                nodeId: node.id,
                                kind: 'FAILED',
                                error: error instanceof Error ? error.message : 'Tool execution failed',
                            },
                        })
                        const stepOutput = GenericStepOutput.create({
                            type: FlowActionType.INTERACTIVE_FLOW,
                            status: StepOutputStatus.FAILED,
                            input: {},
                            output: {
                                state: flowState,
                                executedNodeIds: Array.from(executedNodeIds),
                                skippedNodeIds: Array.from(skippedNodeIds),
                                failedNodeId: node.id,
                                selectedBranches,
                            },
                        }).setErrorMessage(error instanceof Error ? error.message : 'Tool execution failed')
                        return executionState
                            .upsertStep(action.name, stepOutput)
                            .setVerdict({
                                status: FlowRunStatus.FAILED,
                                failedStep: {
                                    name: action.name,
                                    displayName: action.displayName,
                                    message: `Tool ${node.tool} failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                                },
                            })
                    }
                }
                changed = true
            }
            const r2 = reValidateEnumFields({ flowState, fields, alreadyEmitted: emittedRevalidationKeys })
            if (r2.cleared) {
                changed = true
                postValidationDecisions.push(...r2.decisions)
            }

            for (const node of nodes) {
                if (!isUserInputNode(node)) continue
                if (node.singleOptionStrategy !== 'auto') continue
                if (executedNodeIds.has(node.id) || skippedNodeIds.has(node.id)) continue
                if (!node.stateInputs.every(f => !isNil(flowState[f]))) continue
                if (!node.stateOutputs.some(f => isNil(flowState[f]))) continue
                const pending = computePendingInteraction({ node, state: flowState })
                if (pending?.type !== 'pick_from_list') continue
                if (pending.options.length !== 1) continue
                flowState[pending.field] = pending.options[0].value
                executedNodeIds.add(node.id)
                ifDebug('handle:auto-select-single', {
                    nodeId: node.id,
                    field: pending.field,
                    valuePreview: String(pending.options[0].value).slice(0, 40),
                })
                changed = true
            }
        }

        const locale = resolveLocale({ constants, settings })

        const effectivePostValidation = postValidationDecisions.filter(d => isNil(flowState[d.field]))
        const effectiveExtraction = lastExtractionDecisions.filter(d => d.action !== 'reject' || isNil(flowState[d.field]))
        if (effectivePostValidation.length > 0 || effectiveExtraction.length !== lastExtractionDecisions.length) {
            rejectionHint = buildRejectionHint({
                policyDecisions: [...effectiveExtraction, ...effectivePostValidation],
                stateFields: fields,
                locale,
            })
        }

        const nextPauseNode = findNextUserOrConfirmNode({ nodes, state: flowState, executedNodeIds, skippedNodeIds })

        const hasUnresolvedToolOrBranch = nodes.some(n =>
            (isToolNode(n) || isBranchNode(n)) &&
            !executedNodeIds.has(n.id) &&
            !skippedNodeIds.has(n.id),
        )
        if (isNil(nextPauseNode) && hasUnresolvedToolOrBranch) {
            // Distinguish two cases:
            //   (a) "insufficient info" — the unresolved tools' missing
            //       stateInputs are ALL extractable from user text
            //       (i.e. the user simply hasn't said enough yet). Not
            //       a programming error. Emit a natural-language prompt
            //       asking for the missing fields and close the run
            //       gracefully. The next user message opens a fresh
            //       run (chat trigger = new run per message) and the
            //       extractor tries again.
            //   (b) "real deadlock" — at least one missing input is NOT
            //       extractable (e.g. a tool output that never fires).
            //       That's a flow design bug — keep throwing.
            const unresolvedNodes = nodes.filter(n =>
                (isToolNode(n) || isBranchNode(n))
                && !executedNodeIds.has(n.id)
                && !skippedNodeIds.has(n.id),
            )
            const missingExtractable = new Set<string>()
            let hasNonExtractableMissing = false
            for (const n of unresolvedNodes) {
                if (!isToolNode(n)) continue
                for (const fieldName of n.stateInputs) {
                    if (!isNil(flowState[fieldName])) continue
                    const fieldDef = fields.find(f => f.name === fieldName)
                    if (fieldDef && fieldDef.extractable !== false) {
                        missingExtractable.add(fieldName)
                    }
                    else {
                        hasNonExtractableMissing = true
                    }
                }
            }
            ifDebug('handle:insufficient-info-or-deadlock', {
                unresolvedTools: unresolvedNodes.map(n => n.id),
                missingExtractable: Array.from(missingExtractable),
                hasNonExtractableMissing,
                stateKeys: Object.keys(flowState),
            })
            if (!hasNonExtractableMissing && missingExtractable.size > 0) {
                const missingListRaw = Array.from(missingExtractable)
                const primaryMissing = orderMissingByDependency({
                    missing: missingListRaw,
                    nodes,
                })
                const primaryField = primaryMissing[0] ?? missingListRaw[0]
                const primaryFieldDef = fields.find(f => f.name === primaryField)
                const primaryLabel = (primaryFieldDef?.label
                    ? resolveLocalizedString({ value: primaryFieldDef.label, locale })
                    : undefined) ?? primaryFieldDef?.name ?? primaryField
                const primaryDesc = primaryFieldDef?.description
                const resolvedFlowLabel = (settings.flowLabel
                    ? resolveLocalizedString({ value: settings.flowLabel, locale })
                    : undefined)
                    ?? action.displayName
                    ?? (locale.startsWith('it') ? 'la pratica' : 'the procedure')
                const virtualNodeAddendum = buildVirtualNodeAddendum({
                    primaryField,
                    primaryLabel,
                    primaryDesc,
                    flowLabel: resolvedFlowLabel,
                    locale,
                })
                const fallbackIt = `Per procedere con ${resolvedFlowLabel}, può indicarmi **${primaryLabel}**?${primaryDesc ? ` (${primaryDesc})` : ''}`
                const fallbackEn = `To continue with ${resolvedFlowLabel}, please provide **${primaryLabel}**.${primaryDesc ? ` (${primaryDesc})` : ''}`
                const virtualNode: InteractiveFlowUserInputNode = {
                    id: '__insufficient_info__',
                    name: 'insufficient_info',
                    displayName: 'Ask for missing info',
                    nodeType: InteractiveFlowNodeType.USER_INPUT,
                    stateInputs: [],
                    stateOutputs: [primaryField],
                    render: { component: 'TextInput', props: {} },
                    message: {
                        dynamic: true,
                        fallback: { [locale]: locale.startsWith('it') ? fallbackIt : fallbackEn },
                        systemPromptAddendum: virtualNodeAddendum,
                    },
                }
                const missingList = primaryMissing.length > 0 ? primaryMissing : missingListRaw
                let prompt: string | undefined
                if (!isNil(settings.questionGenerator)) {
                    const generated = await questionGenerator.generate({
                        constants,
                        config: settings.questionGenerator,
                        node: virtualNode,
                        stateFields: fields,
                        currentState: redactSensitiveState({ state: flowState, fields }),
                        locale,
                        systemPrompt: settings.systemPrompt,
                        systemPromptAddendum: typeof virtualNode.message === 'object' && 'systemPromptAddendum' in virtualNode.message ? virtualNode.message.systemPromptAddendum : undefined,
                        history,
                    })
                    if (!isNil(generated)) prompt = generated
                }
                if (isNil(prompt)) {
                    prompt = resolveNodeMessage({ message: virtualNode.message, locale })
                        ?? 'Per proseguire ho bisogno di qualche informazione in più.'
                }
                if (!isNil(rejectionHint)) {
                    prompt = `${rejectionHint}\n\n${prompt}`
                }
                ifDebug('handle:insufficient-info:message', {
                    missing: missingList,
                    messagePreview: prompt.slice(0, 140),
                    prependedRejectionHint: !isNil(rejectionHint),
                })
                if (!isNil(constants.workerHandlerId) && !isNil(constants.httpRequestId)) {
                    try {
                        await workerSocket.getWorkerClient().sendFlowResponse({
                            workerHandlerId: constants.workerHandlerId,
                            httpRequestId: constants.httpRequestId,
                            runResponse: {
                                status: 200,
                                body: { type: 'markdown', value: prompt, files: [] },
                                headers: {},
                            },
                        })
                        ifDebug('handle:insufficient-info:sendFlowResponse:result', { ok: true })
                    }
                    catch (e) {
                        ifDebug('handle:insufficient-info:sendFlowResponse:result', {
                            ok: false,
                            error: (e as Error).message,
                        })
                    }
                }
                const pendingForInsufficient: PendingInteraction | null = missingList.length > 0
                    ? { type: 'open_text', field: missingList[0], nodeId: '__insufficient_info__' }
                    : null
                await persistSession({ botMessage: prompt, pendingInteraction: pendingForInsufficient })
                const stepOutput = GenericStepOutput.create({
                    type: FlowActionType.INTERACTIVE_FLOW,
                    status: StepOutputStatus.SUCCEEDED,
                    input: {},
                    output: {
                        state: flowState,
                        executedNodeIds: Array.from(executedNodeIds),
                        skippedNodeIds: Array.from(skippedNodeIds),
                        selectedBranches,
                    },
                })
                return executionState.upsertStep(action.name, stepOutput)
            }
            throw new EngineGenericError(
                'InteractiveFlowDeadlock',
                'Circular dependency detected: one or more nodes cannot run because their required inputs are never produced',
            )
        }

        if (nextPauseNode) {
            let message = resolveNodeMessage({ message: nextPauseNode.message, locale })
            const nodeMessage = nextPauseNode.message
            const isDynamicMessage = typeof nodeMessage === 'object' && nodeMessage !== null && 'dynamic' in nodeMessage && nodeMessage.dynamic === true
            ifDebug('handle:pause:begin', {
                nodeId: nextPauseNode.id,
                hasDynamic: isDynamicMessage,
                hasQuestionGenerator: !isNil(settings.questionGenerator),
            })
            if (isDynamicMessage && !isNil(settings.questionGenerator)) {
                const generated = await questionGenerator.generate({
                    constants,
                    config: settings.questionGenerator,
                    node: nextPauseNode,
                    stateFields: fields,
                    currentState: redactSensitiveState({ state: flowState, fields }),
                    locale,
                    systemPrompt: settings.systemPrompt,
                    systemPromptAddendum: typeof nodeMessage === 'object' && 'systemPromptAddendum' in nodeMessage ? nodeMessage.systemPromptAddendum : undefined,
                    history,
                })
                if (!isNil(generated)) {
                    message = generated
                }
                else if (isNil(message)) {
                    const firstTarget = fields.find(f => nextPauseNode.stateOutputs.includes(f.name))
                    const label = firstTarget?.label ? resolveLocalizedString({ value: firstTarget.label, locale }) : firstTarget?.name
                    message = `Please provide ${label ?? nextPauseNode.stateOutputs[0] ?? 'the requested information'}`
                }
            }
            if (!isNil(rejectionHint) && !isNil(message)) {
                message = `${rejectionHint}\n\n${message}`
            }
            ifDebug('handle:pause:message', {
                nodeId: nextPauseNode.id,
                messagePreview: (message ?? '').slice(0, 120),
                generatedFromLlm: isDynamicMessage && !isNil(settings.questionGenerator),
                prependedRejectionHint: !isNil(rejectionHint),
            })
            const stepOutput = GenericStepOutput.create({
                type: FlowActionType.INTERACTIVE_FLOW,
                status: StepOutputStatus.PAUSED,
                input: {},
                output: {
                    state: flowState,
                    executedNodeIds: Array.from(executedNodeIds),
                    skippedNodeIds: Array.from(skippedNodeIds),
                    currentNodeId: nextPauseNode.id,
                    selectedBranches,
                },
            })
            await interactiveFlowEvents.emit({
                constants,
                event: { stepName: action.name, nodeId: nextPauseNode.id, kind: 'PAUSED', locale },
            })
            const pendingInteractionForPause = computePendingInteraction({ node: nextPauseNode, state: flowState })
            const pauseBody = buildPauseBody({
                message: message ?? '',
                pendingInteraction: pendingInteractionForPause,
                node: nextPauseNode,
                state: flowState,
                locale,
            })
            // If this flow was triggered via a sync webhook (AP chat UI,
            // sync forms, or any sync HTTP caller), push the bot's
            // pause message back to the caller in the `HumanInputFormResult`
            // shape that the chat UI consumes — otherwise the caller
            // would hang until webhook timeout and the user sees "No
            // response from the chatbot. Ensure that Respond on UI is
            // in your flow."
            if (!isNil(constants.workerHandlerId) && !isNil(constants.httpRequestId)) {
                ifDebug('handle:pause:sendFlowResponse', {
                    workerHandlerId: constants.workerHandlerId,
                    httpRequestId: constants.httpRequestId,
                    bodyType: pauseBody.type,
                })
                try {
                    await workerSocket.getWorkerClient().sendFlowResponse({
                        workerHandlerId: constants.workerHandlerId,
                        httpRequestId: constants.httpRequestId,
                        runResponse: {
                            status: 200,
                            body: pauseBody,
                            headers: {},
                        },
                    })
                    ifDebug('handle:pause:sendFlowResponse:result', { ok: true })
                }
                catch (e) {
                    ifDebug('handle:pause:sendFlowResponse:result', {
                        ok: false,
                        error: (e as Error).message,
                    })
                }
            }
            await persistSession({
                botMessage: message ?? undefined,
                pendingInteraction: pendingInteractionForPause,
            })
            return executionState
                .upsertStep(action.name, stepOutput)
                .setVerdict({ status: FlowRunStatus.PAUSED })
        }

        const stepOutput = GenericStepOutput.create({
            type: FlowActionType.INTERACTIVE_FLOW,
            status: StepOutputStatus.SUCCEEDED,
            input: {},
            output: {
                state: flowState,
                executedNodeIds: Array.from(executedNodeIds),
                skippedNodeIds: Array.from(skippedNodeIds),
                selectedBranches,
            },
        })
        // Final success bubble for any sync chat/webhook caller. Pull
        // the most informative state field (caseId-like ids in common
        // banking flows) to surface a meaningful confirmation line.
        ifDebug('handle:success:begin', {
            stateKeys: Object.keys(flowState),
            caseId: typeof flowState.caseId === 'string' ? flowState.caseId : null,
            workerHandlerId: constants.workerHandlerId,
            httpRequestId: constants.httpRequestId,
        })
        const summary = formatSuccessSummary(flowState)
        if (!isNil(constants.workerHandlerId) && !isNil(constants.httpRequestId)) {
            try {
                await workerSocket.getWorkerClient().sendFlowResponse({
                    workerHandlerId: constants.workerHandlerId,
                    httpRequestId: constants.httpRequestId,
                    runResponse: {
                        status: 200,
                        body: { type: 'markdown', value: summary, files: [] },
                        headers: {},
                    },
                })
                ifDebug('handle:success:sendFlowResponse:result', { ok: true })
            }
            catch (e) {
                ifDebug('handle:success:sendFlowResponse:result', {
                    ok: false,
                    error: (e as Error).message,
                })
            }
        }
        await persistSession({ botMessage: summary, terminal: true })
        return executionState.upsertStep(action.name, stepOutput)
    },
}

function formatSuccessSummary(state: InteractiveFlowState): string {
    // Heuristic: if state has a `caseId` (produced by `submit_closure`
    // in the estinzione flow) surface it. Otherwise fall back to a
    // generic "operation completed" line. Works for any interactive
    // flow without hard-coding per-scenario strings.
    const caseId = state.caseId
    if (typeof caseId === 'string' && caseId.length > 0) {
        return `✅ Pratica inviata con successo.\n\n**ID pratica:** \`${caseId}\``
    }
    return '✅ Operazione completata con successo.'
}
