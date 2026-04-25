import { apId, PrincipalType } from '@activepieces/shared'
import { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { databaseConnection } from '../../../../src/app/database/database-connection'
import { generateMockToken } from '../../../helpers/auth'
import { mockAndSaveBasicSetup } from '../../../helpers/mocks'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance
let engineToken: string
let projectId: string

beforeAll(async () => {
    app = await setupTestEnvironment()
    const { mockPlatform, mockProject } = await mockAndSaveBasicSetup()
    projectId = mockProject.id
    engineToken = await generateMockToken({
        id: apId(),
        type: PrincipalType.ENGINE,
        projectId,
        platform: { id: mockPlatform.id },
    })
})

afterAll(async () => {
    await teardownTestEnvironment()
})

beforeEach(async () => {
    const ds = databaseConnection()
    await ds.query('DELETE FROM "store-entry" WHERE "projectId" = $1', [projectId])
})

const STORE_PATH_GET = '/api/v1/store-entries/with-version'
const STORE_PATH_PUT = '/api/v1/store-entries/put-with-version'

async function getWithVersion(key: string): Promise<{ status: number, body: unknown }> {
    const res = await app.inject({
        method: 'GET',
        url: `${STORE_PATH_GET}?key=${encodeURIComponent(key)}`,
        headers: { authorization: `Bearer ${engineToken}` },
    })
    return { status: res.statusCode, body: res.statusCode === 200 ? res.json() : res.body }
}

async function putWithVersion(key: string, value: unknown, expectedVersion: number): Promise<{ status: number, body: unknown }> {
    const res = await app.inject({
        method: 'POST',
        url: STORE_PATH_PUT,
        headers: { authorization: `Bearer ${engineToken}`, 'content-type': 'application/json' },
        payload: { key, value, expectedVersion },
    })
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null }
}

describe('command-layer store-entries CAS endpoints (DEV-04 / A-09 canonical)', () => {
    it('A-09.1: GET /with-version on missing key → 404', async () => {
        const res = await getWithVersion('missing-key-xyz')
        expect(res.status).toBe(404)
    })

    it('A-09.2: POST /put-with-version with expectedVersion=0 on new key → 200 + version=1', async () => {
        const res = await putWithVersion('cas-key-1', { hello: 'world' }, 0)
        expect(res.status).toBe(200)
        expect((res.body as { version: number }).version).toBe(1)
    })

    it('A-09.3: stale expectedVersion → 412 + currentVersion in body', async () => {
        await putWithVersion('cas-key-2', { v: 'a' }, 0)
        const stale = await putWithVersion('cas-key-2', { v: 'b' }, 0)
        expect(stale.status).toBe(412)
        expect((stale.body as { currentVersion: number }).currentVersion).toBe(1)
    })

    it('A-09.4: sequential v0 → v1 → v2 returns monotonic versions + GET reflects latest', async () => {
        const r1 = await putWithVersion('cas-key-3', { step: 1 }, 0)
        expect((r1.body as { version: number }).version).toBe(1)

        const r2 = await putWithVersion('cas-key-3', { step: 2 }, 1)
        expect((r2.body as { version: number }).version).toBe(2)

        const r3 = await putWithVersion('cas-key-3', { step: 3 }, 2)
        expect((r3.body as { version: number }).version).toBe(3)

        const get = await getWithVersion('cas-key-3')
        expect(get.status).toBe(200)
        const body = get.body as { value: unknown, version: number }
        expect(body.version).toBe(3)
        expect(body.value).toEqual({ step: 3 })
    })
})
