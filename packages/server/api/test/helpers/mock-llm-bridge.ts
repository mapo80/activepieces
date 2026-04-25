import http from 'node:http'

/**
 * Minimal mock for `claude-code-openai-bridge` /v1/chat/completions.
 * Returns deterministic SET_FIELDS commands sufficient for the
 * estinzione + consultazione smoke fixtures used by W-09.
 *
 * Spawn with:
 *   node packages/server/api/test/helpers/mock-llm-bridge.ts
 *
 * Env:
 *   PORT (default 8787)
 */

type ChatMessage = { role: 'system' | 'user' | 'assistant', content: string }

const PORT = Number(process.env.PORT ?? 8787)

function pickResponse(messages: ChatMessage[]): string {
    const last = messages.findLast?.((m) => m.role === 'user') ?? messages[messages.length - 1]
    const text = (last?.content ?? '').toLowerCase()
    if (text.includes('motivazione') || /\b0[1-9]\b/.test(text)) {
        return JSON.stringify({
            commands: [{
                type: 'SET_FIELDS',
                updates: [{ field: 'closureReasonCode', value: '01', evidence: text.slice(0, 40) || 'motivazione 01' }],
            }],
        })
    }
    if (text.includes('annulla')) {
        return JSON.stringify({
            commands: [{ type: 'REQUEST_CANCEL', reason: 'user-asked' }],
        })
    }
    if (text.length === 0) {
        return JSON.stringify({ commands: [] })
    }
    const firstWord = text.split(/\s+/)[0] || 'cliente'
    return JSON.stringify({
        commands: [{
            type: 'SET_FIELDS',
            updates: [{ field: 'customerName', value: firstWord, evidence: firstWord }],
        }],
    })
}

const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, mock: true }))
        return
    }
    if (req.method === 'POST' && req.url?.startsWith('/v1/chat/completions')) {
        const chunks: Buffer[] = []
        req.on('data', (c) => chunks.push(c as Buffer))
        req.on('end', () => {
            try {
                const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
                const content = pickResponse(body.messages ?? [])
                res.writeHead(200, { 'content-type': 'application/json' })
                res.end(JSON.stringify({
                    id: 'mock-' + Date.now(),
                    object: 'chat.completion',
                    created: Math.floor(Date.now() / 1000),
                    model: body.model ?? 'mock-model',
                    choices: [{
                        index: 0,
                        message: { role: 'assistant', content },
                        finish_reason: 'stop',
                    }],
                    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
                }))
            }
            catch (err) {
                res.writeHead(500, { 'content-type': 'application/json' })
                res.end(JSON.stringify({ error: String(err) }))
            }
        })
        return
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'not-found' }))
})

server.listen(PORT, () => {
    process.stdout.write(`mock-llm-bridge listening on :${PORT}\n`)
})
