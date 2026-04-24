import { randomUUID } from 'node:crypto'
import { Pool, PoolClient } from 'pg'

const CONN = process.env.SPIKE_PG_URL ?? 'postgresql://platform:platform_pwd@localhost:5432/spike_command_layer'

const pool = new Pool({ connectionString: CONN, max: 20 })

type TestResult = {
    id: string
    name: string
    status: 'VERDE' | 'GIALLO' | 'ROSSO'
    detail: string
    durationMs: number
}

async function resetTables(): Promise<void> {
    await pool.query('TRUNCATE TABLE "spike_outbox","spike_session_sequence","spike_turn_log"')
}

async function acquireLease({ client, turnId, sessionId, flowRunId, workerId, ttlSeconds }: {
    client: PoolClient
    turnId: string
    sessionId: string
    flowRunId: string
    workerId: string
    ttlSeconds: number
}): Promise<{ acquired: boolean, leaseToken?: string }> {
    const leaseToken = randomUUID()
    const res = await client.query(
        `INSERT INTO "spike_turn_log" (
            "turnId","sessionId","flowRunId","status","workerId","leaseToken","lockedUntil","createdAt"
        ) VALUES ($1,$2,$3,'in-progress',$4,$5,NOW() + ($6 || ' seconds')::INTERVAL, NOW())
        ON CONFLICT ("turnId") DO UPDATE SET
            "workerId" = EXCLUDED."workerId",
            "leaseToken" = EXCLUDED."leaseToken",
            "lockedUntil" = EXCLUDED."lockedUntil"
        WHERE "spike_turn_log"."status" = 'in-progress'
          AND "spike_turn_log"."lockedUntil" < NOW()
        RETURNING "turnId"`,
        [turnId, sessionId, flowRunId, workerId, leaseToken, String(ttlSeconds)],
    )
    return res.rowCount && res.rowCount > 0 ? { acquired: true, leaseToken } : { acquired: false }
}

async function test03_leaseConcurrency(): Promise<TestResult> {
    const start = Date.now()
    await resetTables()
    const turnId = `turn-${randomUUID()}`
    const sessionId = 'session-A'
    const flowRunId = 'run-1'
    const workers = [0, 1, 2, 3].map(i => `worker-${i}`)
    const results = await Promise.all(workers.map(async (workerId) => {
        const client = await pool.connect()
        try {
            return acquireLease({ client, turnId, sessionId, flowRunId, workerId, ttlSeconds: 30 })
        }
        finally {
            client.release()
        }
    }))
    const acquired = results.filter(r => r.acquired).length
    const durationMs = Date.now() - start
    if (acquired === 1) {
        return {
            id: 'P0A-SPIKE-03',
            name: 'Lease concurrency (4 worker same turnId)',
            status: 'VERDE',
            detail: `exactly 1 acquirer out of 4 (acquired=${acquired})`,
            durationMs,
        }
    }
    return {
        id: 'P0A-SPIKE-03',
        name: 'Lease concurrency (4 worker same turnId)',
        status: 'ROSSO',
        detail: `expected exactly 1 acquirer, got ${acquired}`,
        durationMs,
    }
}

async function test04_commitCAS(): Promise<TestResult> {
    const start = Date.now()
    await resetTables()
    const turnId = `turn-${randomUUID()}`
    const client = await pool.connect()
    try {
        const acquire1 = await acquireLease({ client, turnId, sessionId: 's', flowRunId: 'r', workerId: 'w1', ttlSeconds: 30 })
        if (!acquire1.acquired || !acquire1.leaseToken) {
            return { id: 'P0A-SPIKE-04', name: 'Commit CAS', status: 'ROSSO', detail: 'initial acquire failed', durationMs: Date.now() - start }
        }
        const staleToken = acquire1.leaseToken
        await pool.query('UPDATE "spike_turn_log" SET "lockedUntil" = NOW() - INTERVAL \'5 seconds\' WHERE "turnId" = $1', [turnId])
        await pool.query('UPDATE "spike_turn_log" SET "status" = \'failed\', "failedReason" = \'lease-expired\' WHERE "lockedUntil" < NOW() AND "status" = \'in-progress\'')
        const prepareAttempt = await pool.query(
            `UPDATE "spike_turn_log" SET "status" = 'prepared' WHERE "turnId" = $1 AND "leaseToken" = $2 AND "status" = 'in-progress' AND "lockedUntil" >= NOW() RETURNING "turnId"`,
            [turnId, staleToken],
        )
        const durationMs = Date.now() - start
        if (prepareAttempt.rowCount === 0) {
            return { id: 'P0A-SPIKE-04', name: 'Commit CAS (stale worker blocked)', status: 'VERDE', detail: 'stale worker rejected by CAS on leaseToken/status/lockedUntil', durationMs }
        }
        return { id: 'P0A-SPIKE-04', name: 'Commit CAS', status: 'ROSSO', detail: 'stale worker erroneously committed', durationMs }
    }
    finally {
        client.release()
    }
}

async function test05_heartbeat(): Promise<TestResult> {
    const start = Date.now()
    await resetTables()
    const turnId = `turn-${randomUUID()}`
    const acq = await (async () => {
        const client = await pool.connect()
        try {
            return acquireLease({ client, turnId, sessionId: 's', flowRunId: 'r', workerId: 'w1', ttlSeconds: 3 })
        }
        finally {
            client.release()
        }
    })()
    if (!acq.acquired || !acq.leaseToken) {
        return { id: 'P0A-SPIKE-05', name: 'Heartbeat', status: 'ROSSO', detail: 'initial acquire failed', durationMs: Date.now() - start }
    }
    await new Promise(r => setTimeout(r, 1500))
    const beat = await pool.query(
        `UPDATE "spike_turn_log" SET "lockedUntil" = NOW() + INTERVAL '3 seconds'
         WHERE "turnId" = $1 AND "leaseToken" = $2 AND "status" = 'in-progress' AND "lockedUntil" >= NOW()
         RETURNING "turnId"`,
        [turnId, acq.leaseToken],
    )
    if (beat.rowCount === 0) {
        return { id: 'P0A-SPIKE-05', name: 'Heartbeat', status: 'ROSSO', detail: 'heartbeat did not extend lease', durationMs: Date.now() - start }
    }
    await new Promise(r => setTimeout(r, 2500))
    const recover = await pool.query(
        `UPDATE "spike_turn_log" SET "status" = 'failed', "failedReason" = 'lease-expired'
         WHERE "status" = 'in-progress' AND "lockedUntil" < NOW()
         RETURNING "turnId"`,
    )
    const row = await pool.query('SELECT "status" FROM "spike_turn_log" WHERE "turnId" = $1', [turnId])
    const durationMs = Date.now() - start
    if (recover.rowCount === 0 && row.rows[0]?.status === 'in-progress') {
        return { id: 'P0A-SPIKE-05', name: 'Heartbeat (lease extension survives recovery)', status: 'VERDE', detail: 'lease extended 1.5s before expiry, not reclaimed', durationMs }
    }
    return { id: 'P0A-SPIKE-05', name: 'Heartbeat', status: 'ROSSO', detail: `recovery reclaimed alive turn (status=${row.rows[0]?.status}, recovered=${recover.rowCount})`, durationMs }
}

async function test06_saga(): Promise<TestResult> {
    const start = Date.now()
    await resetTables()
    const turnHappy = `turn-${randomUUID()}`
    const turnCompensated = `turn-${randomUUID()}`
    const client = await pool.connect()
    try {
        const acqH = await acquireLease({ client, turnId: turnHappy, sessionId: 'sH', flowRunId: 'rH', workerId: 'w1', ttlSeconds: 30 })
        const acqC = await acquireLease({ client, turnId: turnCompensated, sessionId: 'sC', flowRunId: 'rC', workerId: 'w1', ttlSeconds: 30 })
        if (!acqH.acquired || !acqC.acquired) {
            return { id: 'P0A-SPIKE-06', name: 'Saga states', status: 'ROSSO', detail: 'setup acquire failed', durationMs: Date.now() - start }
        }
        await pool.query(
            `UPDATE "spike_turn_log" SET "status" = 'prepared', "committedAt" = NOW()
             WHERE "turnId" = $1 AND "leaseToken" = $2 AND "status" = 'in-progress'`,
            [turnHappy, acqH.leaseToken],
        )
        await pool.query(
            `UPDATE "spike_turn_log" SET "status" = 'prepared', "committedAt" = NOW()
             WHERE "turnId" = $1 AND "leaseToken" = $2 AND "status" = 'in-progress'`,
            [turnCompensated, acqC.leaseToken],
        )
        const finalized = await pool.query(
            `UPDATE "spike_turn_log" SET "status" = 'finalized'
             WHERE "turnId" = $1 AND "leaseToken" = $2 AND "status" = 'prepared' RETURNING "turnId"`,
            [turnHappy, acqH.leaseToken],
        )
        const compensated = await pool.query(
            `UPDATE "spike_turn_log" SET "status" = 'compensated', "failedReason" = 't2-cas-conflict'
             WHERE "turnId" = $1 AND "leaseToken" = $2 AND "status" = 'prepared' RETURNING "turnId"`,
            [turnCompensated, acqC.leaseToken],
        )
        const doubleFinalize = await pool.query(
            `UPDATE "spike_turn_log" SET "status" = 'finalized'
             WHERE "turnId" = $1 AND "leaseToken" = $2 AND "status" = 'prepared' RETURNING "turnId"`,
            [turnCompensated, acqC.leaseToken],
        )
        const durationMs = Date.now() - start
        if (finalized.rowCount === 1 && compensated.rowCount === 1 && doubleFinalize.rowCount === 0) {
            return { id: 'P0A-SPIKE-06', name: 'Saga prepared→finalized/compensated', status: 'VERDE', detail: 'finalize+compensate disjoint; double-finalize rejected', durationMs }
        }
        return { id: 'P0A-SPIKE-06', name: 'Saga', status: 'ROSSO', detail: `finalized=${finalized.rowCount} compensated=${compensated.rowCount} doubleFinalize=${doubleFinalize.rowCount}`, durationMs }
    }
    finally {
        client.release()
    }
}

async function allocateSequence(sessionId: string, n: number): Promise<{ from: bigint, to: bigint }> {
    const res = await pool.query(
        `INSERT INTO "spike_session_sequence" ("sessionId", "nextSequence", "updatedAt")
         VALUES ($1, $2, NOW())
         ON CONFLICT ("sessionId") DO UPDATE SET
            "nextSequence" = "spike_session_sequence"."nextSequence" + EXCLUDED."nextSequence",
            "updatedAt" = NOW()
         RETURNING "nextSequence"`,
        [sessionId, n],
    )
    const next = BigInt(res.rows[0].nextSequence)
    return { from: next - BigInt(n) + 1n, to: next }
}

async function test07_sequenceAtomicity(): Promise<TestResult> {
    const start = Date.now()
    await resetTables()
    const sessionId = 'session-X'
    const N = 100
    const allocations = await Promise.all(
        Array.from({ length: N }, (_, i) => allocateSequence(sessionId, 1).then(r => ({ i, from: r.from, to: r.to }))),
    )
    const totals = allocations.map(a => a.from)
    const unique = new Set(totals.map(String))
    const max = allocations.reduce((m, a) => a.to > m ? a.to : m, 0n)
    const durationMs = Date.now() - start
    if (unique.size === N && max === BigInt(N)) {
        return { id: 'P0A-SPIKE-07', name: 'Sequence atomicity (100 concurrent)', status: 'VERDE', detail: `all N=${N} unique, max=${max}`, durationMs }
    }
    return { id: 'P0A-SPIKE-07', name: 'Sequence atomicity', status: 'ROSSO', detail: `unique=${unique.size}/${N}, max=${max}`, durationMs }
}

async function test08_publisherFIFO(): Promise<TestResult> {
    const start = Date.now()
    await resetTables()
    const sessions = ['S1', 'S2', 'S3']
    const eventsPerSession = 10
    for (const sid of sessions) {
        for (let i = 0; i < eventsPerSession; i++) {
            const seq = await allocateSequence(sid, 1)
            await pool.query(
                `INSERT INTO "spike_outbox"
                ("outboxEventId","turnId","sessionId","flowRunId","sessionSequence","eventType","eventStatus","payload","createdAt")
                VALUES ($1,$2,$3,'r','${seq.to}','TEST_EVENT','publishable',$4::jsonb, NOW())`,
                [randomUUID(), `turn-${sid}-${i}`, sid, JSON.stringify({ i })],
            )
        }
    }
    const publishers = ['pub-A', 'pub-B']
    const claimed: Record<string, Array<{ sid: string, seq: string }>> = {}
    async function claimBatch(publisherId: string): Promise<Array<{ sid: string, seq: string }>> {
        const client = await pool.connect()
        try {
            await client.query('BEGIN')
            const locked = await client.query(
                `SELECT s."sessionId"
                 FROM "spike_session_sequence" s
                 WHERE EXISTS (
                    SELECT 1 FROM "spike_outbox" o
                    WHERE o."sessionId" = s."sessionId"
                      AND o."eventStatus" = 'publishable'
                      AND o."publishedAt" IS NULL
                      AND (o."claimedUntil" IS NULL OR o."claimedUntil" < NOW())
                 )
                 ORDER BY s."sessionId"
                 LIMIT 1
                 FOR UPDATE OF s SKIP LOCKED`,
            )
            if (locked.rowCount === 0) {
                await client.query('COMMIT')
                return []
            }
            const sessionId = locked.rows[0].sessionId
            const result = await client.query(
                `UPDATE "spike_outbox"
                 SET "claimedBy" = $1, "claimedUntil" = NOW() + INTERVAL '30 seconds'
                 WHERE "sessionId" = $2
                   AND "eventStatus" = 'publishable'
                   AND "publishedAt" IS NULL
                   AND ("claimedUntil" IS NULL OR "claimedUntil" < NOW())
                 RETURNING "sessionId" AS sid, "sessionSequence" AS seq`,
                [publisherId, sessionId],
            )
            await client.query('COMMIT')
            return result.rows.map(r => ({ sid: r.sid, seq: String(r.seq) }))
        }
        catch (err) {
            await client.query('ROLLBACK').catch(() => {})
            throw err
        }
        finally {
            client.release()
        }
    }
    for (const p of publishers) claimed[p] = []
    for (let i = 0; i < 6; i++) {
        const batches = await Promise.all(publishers.map(p => claimBatch(p)))
        batches.forEach((b, idx) => {
            claimed[publishers[idx]].push(...b)
        })
    }
    let sessionViolations = 0
    const sessionPublisher: Record<string, string> = {}
    for (const [pubId, rows] of Object.entries(claimed)) {
        for (const { sid } of rows) {
            if (sessionPublisher[sid] && sessionPublisher[sid] !== pubId) {
                sessionViolations++
            }
            sessionPublisher[sid] = pubId
        }
    }
    let orderingViolations = 0
    for (const [, rows] of Object.entries(claimed)) {
        const bySession: Record<string, string[]> = {}
        for (const r of rows) {
            bySession[r.sid] = bySession[r.sid] ?? []
            bySession[r.sid].push(r.seq)
        }
        for (const seqs of Object.values(bySession)) {
            for (let i = 1; i < seqs.length; i++) {
                if (BigInt(seqs[i]) < BigInt(seqs[i - 1])) orderingViolations++
            }
        }
    }
    const durationMs = Date.now() - start
    if (sessionViolations === 0 && orderingViolations === 0) {
        return { id: 'P0A-SPIKE-08', name: 'Publisher FIFO per session', status: 'VERDE', detail: 'no session cross-publisher, FIFO preserved within publisher', durationMs }
    }
    return { id: 'P0A-SPIKE-08', name: 'Publisher FIFO', status: 'ROSSO', detail: `sessionViolations=${sessionViolations} orderingViolations=${orderingViolations}`, durationMs }
}

async function test09_storeCAS(): Promise<TestResult> {
    const start = Date.now()
    await pool.query(
        `CREATE TABLE IF NOT EXISTS "spike_store_cas" (
            "key" character varying(256) NOT NULL,
            "value" jsonb NOT NULL,
            "version" bigint NOT NULL DEFAULT 0,
            CONSTRAINT "pk_spike_store_cas" PRIMARY KEY ("key")
        )`,
    )
    await pool.query('TRUNCATE TABLE "spike_store_cas"')
    await pool.query(
        `INSERT INTO "spike_store_cas" ("key","value","version") VALUES ($1, $2::jsonb, 1)`,
        ['k1', JSON.stringify({ v: 1 })],
    )
    async function upsertWithCAS({ key, value, expectedVersion }: { key: string, value: unknown, expectedVersion: number }): Promise<{ status: 'ok' | 'conflict', version?: number, current?: number }> {
        const res = await pool.query(
            `UPDATE "spike_store_cas" SET "value" = $1::jsonb, "version" = "version" + 1
             WHERE "key" = $2 AND "version" = $3 RETURNING "version"`,
            [JSON.stringify(value), key, expectedVersion],
        )
        if (res.rowCount === 1) return { status: 'ok', version: res.rows[0].version }
        const cur = await pool.query('SELECT "version" FROM "spike_store_cas" WHERE "key" = $1', [key])
        return { status: 'conflict', current: cur.rows[0]?.version }
    }
    const [a, b] = await Promise.all([
        upsertWithCAS({ key: 'k1', value: { v: 2, who: 'A' }, expectedVersion: 1 }),
        upsertWithCAS({ key: 'k1', value: { v: 2, who: 'B' }, expectedVersion: 1 }),
    ])
    const winners = [a, b].filter(r => r.status === 'ok').length
    const losers = [a, b].filter(r => r.status === 'conflict').length
    const durationMs = Date.now() - start
    if (winners === 1 && losers === 1) {
        return { id: 'P0A-SPIKE-09', name: 'Store CAS (412 on concurrent)', status: 'VERDE', detail: '1 winner, 1 conflict', durationMs }
    }
    return { id: 'P0A-SPIKE-09', name: 'Store CAS', status: 'ROSSO', detail: `winners=${winners} losers=${losers}`, durationMs }
}

async function main(): Promise<void> {
    const tests: Array<() => Promise<TestResult>> = [
        test03_leaseConcurrency,
        test04_commitCAS,
        test05_heartbeat,
        test06_saga,
        test07_sequenceAtomicity,
        test08_publisherFIFO,
        test09_storeCAS,
    ]
    const results: TestResult[] = []
    for (const t of tests) {
        try {
            const r = await t()
            results.push(r)
        }
        catch (err) {
            results.push({ id: 'EXCEPTION', name: t.name, status: 'ROSSO', detail: `exception: ${String(err).slice(0, 200)}`, durationMs: 0 })
        }
    }
    console.log(JSON.stringify({ runAt: new Date().toISOString(), results }, null, 2))
    await pool.end()
    const anyRed = results.some(r => r.status === 'ROSSO')
    process.exit(anyRed ? 1 : 0)
}

main().catch(err => {
    console.error('FATAL', err)
    process.exit(2)
})
