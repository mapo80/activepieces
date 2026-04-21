import { normalization } from './normalization'

function detectMetaIntent({ message }: { message: string }): MetaIntent | null {
    const normalized = normalization.normalize(message)
    if (normalized.length === 0) return null

    if (/\bcosa\b.*(chiest|volev|domand)/.test(normalized)) return 'ask-repeat'
    if (/\bripet|spieg|riassum|chiarisc/.test(normalized)) return 'ask-repeat'
    if (/\bnon\b.*(capit|capisc|chiaro)/.test(normalized)) return 'ask-clarify'
    if (/\b(che|a che)\s+punto\b|\bdove\s+siamo/.test(normalized)) return 'ask-progress'
    if (/\bcome\s+funziona\b|\baiuto\b|\bhelp\b/.test(normalized)) return 'ask-help'
    if (/\bannulla\b|\binterrom[pr]i\b|\bcancel\b/.test(normalized)) return 'ask-cancel'

    return null
}

function renderMetaAnswer({ intent, state, currentNode, flowLabel }: {
    intent: MetaIntent
    state: Record<string, unknown>
    currentNode: CurrentNodeDescriptor
    flowLabel?: string
}): string {
    const knownFields = formatKnownFields({ state })
    const pendingField = currentNode.nextMissingField ?? currentNode.displayField ?? 'la prossima informazione'
    const flowPhrase = flowLabel ? ` per ${flowLabel}` : ''

    switch (intent) {
        case 'ask-repeat':
            return [
                `Ti ho chiesto: ${currentNode.prompt ?? pendingField}.`,
                knownFields ? `Ho già raccolto: ${knownFields}.` : null,
                `Digita la tua risposta o scrivi 'annulla' per interrompere${flowPhrase}.`,
            ].filter(Boolean).join(' ')
        case 'ask-clarify':
            return [
                `Provo a spiegarmi meglio: ho bisogno di ${pendingField}.`,
                knownFields ? `Fin qui ho: ${knownFields}.` : null,
                'Scrivi la tua risposta o \'annulla\' per interrompere.',
            ].filter(Boolean).join(' ')
        case 'ask-progress':
            return [
                `Siamo al passo "${currentNode.displayName ?? currentNode.nodeId}"${flowPhrase}.`,
                knownFields ? `Dati raccolti: ${knownFields}.` : null,
                `Manca: ${pendingField}.`,
            ].filter(Boolean).join(' ')
        case 'ask-help':
            return [
                `Sto guidando${flowPhrase}. Ti farò una domanda alla volta.`,
                `Al momento mi serve: ${pendingField}.`,
                'Rispondi digitando la risposta o \'annulla\' per interrompere.',
            ].filter(Boolean).join(' ')
        case 'ask-cancel':
            return 'Operazione interrotta su tua richiesta. Se vuoi ricominciare, invia un nuovo messaggio.'
    }
}

function formatKnownFields({ state }: { state: Record<string, unknown> }): string {
    const entries = Object.entries(state).filter(([, v]) => v !== null && v !== undefined && v !== '')
    if (entries.length === 0) return ''
    return entries.map(([k, v]) => `${k}=${formatValuePreview(v)}`).join(', ')
}

function formatValuePreview(value: unknown): string {
    if (typeof value === 'string') return `"${value.length > 40 ? value.slice(0, 37) + '…' : value}"`
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (Array.isArray(value)) return `[${value.length} elementi]`
    if (value && typeof value === 'object') return '(oggetto)'
    return String(value)
}

export const metaQuestionHandler = {
    detectMetaIntent,
    renderMetaAnswer,
}

export type MetaIntent = 'ask-repeat' | 'ask-clarify' | 'ask-progress' | 'ask-help' | 'ask-cancel'

export type CurrentNodeDescriptor = {
    nodeId: string
    displayName?: string
    displayField?: string
    prompt?: string
    nextMissingField?: string
}
