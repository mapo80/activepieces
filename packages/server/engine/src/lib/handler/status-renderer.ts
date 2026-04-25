type RenderInput = {
    state: Record<string, unknown>
    locale?: string
    success: boolean
    errorReason?: string
}

function render({ state, locale, success, errorReason }: RenderInput): string {
    const isItalian = (locale ?? 'it').startsWith('it')
    if (!success) {
        if (isItalian) {
            return errorReason
                ? `Si è verificato un errore: ${truncate(errorReason, 200)}`
                : 'Si è verificato un errore. Riprova fra un istante.'
        }
        return errorReason
            ? `An error occurred: ${truncate(errorReason, 200)}`
            : 'An error occurred. Please retry shortly.'
    }
    const caseId = typeof state.caseId === 'string' ? state.caseId : null
    if (caseId) {
        return isItalian
            ? `Pratica inviata. ID: ${caseId}`
            : `Submission completed. Case ID: ${caseId}`
    }
    return isItalian ? 'Operazione completata.' : 'Operation completed.'
}

function combine({ preDagAck, status }: { preDagAck: string, status: string }): string {
    if (!preDagAck || preDagAck.trim().length === 0) return status
    return `${preDagAck}\n\n${status}`
}

function truncate(s: string, n: number): string {
    return s.length > n ? `${s.slice(0, n)}…` : s
}

export const statusRenderer = {
    render,
    combine,
}
