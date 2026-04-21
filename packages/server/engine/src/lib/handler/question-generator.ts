import { InteractiveFlowConfirmNode, InteractiveFlowStateField, InteractiveFlowUserInputNode } from '@activepieces/shared'
import { EngineConstants } from './context/engine-constants'

type QuestionGeneratorConfig = {
    aiProviderId: string
    model: string
    styleTemplate?: string
    historyWindow?: number
    maxResponseLength?: number
}

async function generate({ constants, config, node, stateFields, currentState, locale, systemPrompt, systemPromptAddendum, history }: {
    constants: EngineConstants
    config: QuestionGeneratorConfig
    node: InteractiveFlowUserInputNode | InteractiveFlowConfirmNode
    stateFields: InteractiveFlowStateField[]
    currentState: Record<string, unknown>
    locale: string
    systemPrompt?: string
    systemPromptAddendum?: string
    history?: Array<{ role: 'user' | 'assistant', text: string }>
}): Promise<string | null> {
    const outputFields = stateFields.filter(f => node.stateOutputs.includes(f.name))
    const fieldsForTarget: Array<Partial<InteractiveFlowStateField> & { name: string }> = outputFields.length > 0
        ? outputFields
        : node.stateOutputs.map(name => ({ name, type: 'string' as const }))
    const targetFields = fieldsForTarget.map(f => {
        const lbl = f.label
        const label = lbl && typeof lbl === 'object' ? lbl[locale] ?? lbl.en : undefined
        return {
            name: f.name,
            label,
            description: f.description,
            format: f.format,
        }
    })

    const preRenderedContent = 'render' in node ? buildPreRenderedContent({ node, state: currentState }) : undefined

    const payload = {
        provider: config.aiProviderId,
        model: config.model,
        locale,
        systemPrompt,
        systemPromptAddendum,
        styleTemplate: config.styleTemplate,
        state: redactSensitive({ state: currentState, fields: stateFields }),
        history: history?.slice(-(config.historyWindow ?? 10)),
        targetFields,
        renderHint: 'render' in node ? { component: node.render.component, props: node.render.props } : undefined,
        preRenderedContent,
        maxOutputTokens: config.maxResponseLength ? Math.max(64, Math.ceil(config.maxResponseLength / 4)) : undefined,
    }

    const url = `${constants.internalApiUrl}v1/engine/interactive-flow-ai/question-generate`
    let response: Response
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${constants.engineToken}`,
            },
            body: JSON.stringify(payload),
        })
    }
    catch {
        return null
    }
    if (!response.ok) {
        return null
    }
    const body = await response.json().catch(() => null) as { text?: string } | null
    const text = body?.text?.trim() ?? ''
    return text.length > 0 ? text : null
}

function redactSensitive({ state, fields }: {
    state: Record<string, unknown>
    fields: InteractiveFlowStateField[]
}): Record<string, unknown> {
    const sensitive = new Set(fields.filter(f => f.sensitive).map(f => f.name))
    if (sensitive.size === 0) return state
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(state)) {
        if (!sensitive.has(k)) out[k] = v
    }
    return out
}

function buildPreRenderedContent({ node, state }: {
    node: InteractiveFlowUserInputNode | InteractiveFlowConfirmNode
    state: Record<string, unknown>
}): string | undefined {
    const props = (node.render?.props ?? {}) as Record<string, unknown>
    const sourceField = typeof props.sourceField === 'string' ? props.sourceField : undefined
    if (!sourceField) return undefined
    const raw = state[sourceField]
    if (!Array.isArray(raw) || raw.length === 0) return undefined
    const columns = Array.isArray(props.columns) ? props.columns as Array<{ key: string, header: string }> : autoDetectColumns({ rows: raw as Array<Record<string, unknown>> })
    if (columns.length === 0) return undefined
    return renderMarkdownTable({ rows: raw as Array<Record<string, unknown>>, columns, maxRows: 50 })
}

function autoDetectColumns({ rows }: { rows: Array<Record<string, unknown>> }): Array<{ key: string, header: string }> {
    const first = rows[0]
    if (!first || typeof first !== 'object') return []
    const PREFERRED = ['id', 'code', 'codice', 'ndg', 'name', 'nome', 'denominazione', 'label', 'descrizione', 'description', 'tipo', 'tipologia', 'tipologia_conto']
    const keys: string[] = []
    for (const pref of PREFERRED) {
        if (pref in first && keys.length < 4) keys.push(pref)
    }
    if (keys.length < 2) {
        for (const k of Object.keys(first)) {
            if (k.endsWith('Specified')) continue
            if (k.startsWith('_')) continue
            const v = first[k]
            if (typeof v === 'string' || typeof v === 'number') {
                if (!keys.includes(k)) keys.push(k)
                if (keys.length >= 4) break
            }
        }
    }
    return keys.map(k => ({ key: k, header: k.charAt(0).toUpperCase() + k.slice(1) }))
}

function renderMarkdownTable({ rows, columns, maxRows = 50 }: {
    rows: Array<Record<string, unknown>>
    columns: Array<{ key: string, header: string }>
    maxRows?: number
}): string {
    const displayed = rows.slice(0, maxRows)
    const overflow = rows.length - displayed.length
    const header = '| ' + columns.map(c => c.header).join(' | ') + ' |'
    const separator = '|' + columns.map(() => '---').join('|') + '|'
    const bodyRows = displayed.map(row => {
        const cells = columns.map(c => formatCellValue(row[c.key]))
        return '| ' + cells.join(' | ') + ' |'
    })
    const parts = [header, separator, ...bodyRows]
    if (overflow > 0) parts.push(`_…e altri ${overflow} elementi non mostrati_`)
    return parts.join('\n')
}

function formatCellValue(value: unknown): string {
    if (value === null || value === undefined) return ''
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (Array.isArray(value)) return `[${value.length}]`
    if (typeof value === 'object') return '(obj)'
    return String(value)
}

export const questionGenerator = {
    generate,
}
