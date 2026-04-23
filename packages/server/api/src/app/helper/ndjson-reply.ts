import { FastifyReply } from 'fastify'

async function streamNdjson<T>(params: {
    reply: FastifyReply
    events: AsyncIterable<T>
    onError?: (err: Error) => T | undefined
}): Promise<void> {
    const { reply, events, onError } = params
    void reply.hijack()
    reply.raw.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
    })
    try {
        for await (const ev of events) {
            if (reply.raw.destroyed) return
            reply.raw.write(`${JSON.stringify(ev)}\n`)
        }
    }
    catch (err) {
        if (onError) {
            const fallback = onError(err as Error)
            if (fallback !== undefined && !reply.raw.destroyed) {
                reply.raw.write(`${JSON.stringify(fallback)}\n`)
            }
        }
    }
    finally {
        if (!reply.raw.destroyed) reply.raw.end()
    }
}

export const ndjsonReply = {
    streamNdjson,
}
