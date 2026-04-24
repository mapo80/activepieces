import { databaseConnection } from '../../database/database-connection'

async function allocate({ sessionId, count }: { sessionId: string, count: number }): Promise<SequenceRange> {
    if (count <= 0) throw new Error('sequence-count-must-be-positive')
    const ds = databaseConnection()
    const result = await ds.query(
        `
        INSERT INTO "interactive_flow_session_sequence" ("sessionId", "nextSequence", "updatedAt")
        VALUES ($1, $2, NOW())
        ON CONFLICT ("sessionId") DO UPDATE SET
            "nextSequence" = "interactive_flow_session_sequence"."nextSequence" + EXCLUDED."nextSequence",
            "updatedAt" = NOW()
        RETURNING "nextSequence"
        `,
        [sessionId, count],
    )
    const next = BigInt(result[0].nextSequence)
    return {
        from: (next - BigInt(count) + 1n).toString(),
        to: next.toString(),
    }
}

async function peek({ sessionId }: { sessionId: string }): Promise<string | null> {
    const ds = databaseConnection()
    const rows = await ds.query('SELECT "nextSequence" FROM "interactive_flow_session_sequence" WHERE "sessionId" = $1', [sessionId])
    if (rows.length === 0) return null
    return String(rows[0].nextSequence)
}

export const sessionSequenceService = {
    allocate,
    peek,
}

export type SequenceRange = {
    from: string
    to: string
}
