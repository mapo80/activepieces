export type PolicyDecision = {
    field: string
    action: 'accept' | 'reject' | 'confirm'
    reason: string
    value?: unknown
    pendingOverwrite?: { field: string, oldValue: unknown, newValue: unknown }
}
