function renderMarkdownTable({ rows, columns, maxRows = 50, overflowText }: {
    rows: Array<Record<string, unknown>>
    columns: Array<{ key: string, header: string, format?: 'eur' | 'date' | 'uppercase' | 'text' }>
    maxRows?: number
    overflowText?: string
}): string {
    if (rows.length === 0) return '_(nessun elemento da mostrare)_'
    const displayed = rows.slice(0, maxRows)
    const overflow = rows.length - displayed.length

    const header = '| ' + columns.map(c => c.header).join(' | ') + ' |'
    const separator = '|' + columns.map(() => '---').join('|') + '|'
    const bodyRows = displayed.map((row, idx) => {
        const cells = columns.map(c => {
            if (c.key === '_idx') return String(idx + 1)
            const value = row[c.key]
            return formatCell({ value, format: c.format })
        })
        return '| ' + cells.join(' | ') + ' |'
    })
    const parts = [header, separator, ...bodyRows]
    if (overflow > 0) {
        const filler = columns.map(() => '…').join(' | ')
        const text = overflowText ?? `…e altri ${overflow} elementi non mostrati`
        parts.push(`| ${filler} |`)
        parts.push(`_${text}_`)
    }
    return parts.join('\n')
}

function renderBulletList({ items, format }: {
    items: Array<{ label: string, value?: unknown, description?: string }>
    format?: (item: { label: string, value?: unknown, description?: string }) => string
}): string {
    if (items.length === 0) return '_(nessun elemento da mostrare)_'
    return items.map(item => {
        if (format) return `- ${format(item)}`
        if (item.description !== undefined) return `- **${item.label}** — ${item.description}`
        if (item.value !== undefined) return `- **${item.label}** — \`${item.value}\``
        return `- ${item.label}`
    }).join('\n')
}

function renderConfirmSummary({ state, summary }: {
    state: Record<string, unknown>
    summary: Array<{ field: string, label: string, format?: 'eur' | 'date' | 'uppercase' | 'text' }>
}): string {
    const rows = summary
        .map(s => {
            const raw = state[s.field]
            if (raw === null || raw === undefined || raw === '') return null
            return `- **${s.label}**: ${formatCell({ value: raw, format: s.format })}`
        })
        .filter((v): v is string => v !== null)
    const body = rows.length > 0 ? rows.join('\n') : '_(nessun dato raccolto)_'
    return [
        '### Riepilogo pratica',
        '',
        body,
        '',
        'Confermi l\'invio? Rispondi **sì** per procedere o **no** per interrompere.',
    ].join('\n')
}

function renderPendingOverwriteConfirm({ field, oldValue, newValue }: {
    field: string
    oldValue: unknown
    newValue: unknown
}): string {
    return [
        `Ho capito che ora vuoi cambiare **${field}** da **${formatCell({ value: oldValue })}** a **${formatCell({ value: newValue })}**.`,
        '',
        'Confermi il cambiamento? Rispondi **sì** per applicare o **no** per mantenere il valore precedente.',
    ].join('\n')
}

function formatCell({ value, format }: { value: unknown, format?: 'eur' | 'date' | 'uppercase' | 'text' }): string {
    if (value === null || value === undefined) return ''
    if (format === 'eur') {
        const n = typeof value === 'number' ? value : parseFloat(String(value))
        if (!isNaN(n)) return `€ ${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        return String(value)
    }
    if (format === 'date' && typeof value === 'string') {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
        if (m) return `${m[3]}/${m[2]}/${m[1]}`
        return value
    }
    if (format === 'uppercase' && typeof value === 'string') return value.toUpperCase()
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (Array.isArray(value)) return `[${value.length} elementi]`
    if (typeof value === 'object') return '(oggetto)'
    return String(value)
}

export const renderState = {
    renderMarkdownTable,
    renderBulletList,
    renderConfirmSummary,
    renderPendingOverwriteConfirm,
    formatCell,
}
