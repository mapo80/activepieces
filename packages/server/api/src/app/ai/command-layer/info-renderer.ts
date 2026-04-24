import { InfoIntent, InterpretTurnMessageKind } from '@activepieces/shared'

type RendererFn = (ctx: RenderContext) => string

type RenderContext = {
    state: Record<string, unknown>
    citedFields: string[]
    locale: string
}

const BUILT_IN_RENDERERS: Record<string, RendererFn> = {
    count_accounts: ({ state }) => {
        const accounts = state.accounts
        const count = Array.isArray(accounts) ? accounts.length : 0
        return `${count} rapport${count === 1 ? 'o attivo' : 'i attivi'}`
    },
    count_matches: ({ state }) => {
        const matches = state.customerMatches
        const count = Array.isArray(matches) ? matches.length : 0
        return `${count} cliente${count === 1 ? ' trovato' : 'i trovati'}`
    },
    closure_reasons_list: ({ state }) => {
        const reasons = state.closureReasons
        if (!Array.isArray(reasons)) return 'Nessuna motivazione disponibile.'
        const lines = reasons.map(r => {
            const code = (r as { code?: string }).code ?? '??'
            const desc = (r as { description?: string }).description ?? ''
            return `- ${code}: ${desc}`
        })
        return `Motivazioni disponibili:\n${lines.join('\n')}`
    },
    pending_status: ({ state }) => {
        return typeof state.__pending === 'string' ? state.__pending : 'Nessuna azione in attesa.'
    },
}

const customRenderers = new Map<string, RendererFn>()

function register({ rendererKey, render }: { rendererKey: string, render: RendererFn }): void {
    customRenderers.set(rendererKey, render)
}

function resolveRenderer({ rendererKey }: { rendererKey: string }): RendererFn | null {
    return customRenderers.get(rendererKey) ?? BUILT_IN_RENDERERS[rendererKey] ?? null
}

function renderAnswer({ intent, state, citedFields, locale }: {
    intent: InfoIntent
    state: Record<string, unknown>
    citedFields: string[]
    locale: string
}): RenderResult {
    const rendererKey = intent.rendererKey
    if (intent.localeTemplates && intent.localeTemplates[locale]) {
        return { ok: true, text: intent.localeTemplates[locale] }
    }
    const renderer = resolveRenderer({ rendererKey })
    if (!renderer) {
        return { ok: false, reason: `renderer-not-found-${rendererKey}` }
    }
    try {
        const text = renderer({ state, citedFields, locale })
        return { ok: true, text }
    }
    catch (err) {
        return { ok: false, reason: `renderer-error: ${String(err).slice(0, 120)}` }
    }
}

function buildAck({ kind, fieldName, infoText }: { kind: InterpretTurnMessageKind, fieldName?: string, infoText?: string }): string {
    switch (kind) {
        case 'ack-only':
            return 'Ricevuto, procedo.'
        case 'info-answer':
            return infoText ?? 'Ecco le informazioni richieste.'
        case 'ask-field':
            return fieldName ? `Puoi dirmi ${fieldName}?` : 'Mi servono altre informazioni per proseguire.'
        case 'meta-answer':
            return 'Certo, ecco cosa stavo chiedendo.'
        case 'cancel-request':
            return 'Vuoi davvero annullare la pratica? Rispondi sì o no.'
        case 'cancel-confirmed':
            return 'Pratica annullata. Puoi iniziarne una nuova quando vuoi.'
        case 'reprompt':
            return 'Non sono sicuro di aver capito: puoi riformulare?'
        default:
            return 'Ok.'
    }
}

export const infoRenderer = {
    register,
    renderAnswer,
    buildAck,
    resolveRenderer,
}

export type RenderResult =
    | { ok: true, text: string }
    | { ok: false, reason: string }
