import {
    apId,
    ProjectId,
    PutStoreEntryRequest,
    sanitizeObjectForPostgresql,
    StoreEntry,
} from '@activepieces/shared'
import { commandLayerMetrics } from '../ai/command-layer/metrics'
import { repoFactory } from '../core/db/repo-factory'
import { databaseConnection } from '../database/database-connection'
import { StoreEntryEntity } from './store-entry-entity'

const storeEntryRepo = repoFactory<StoreEntry>(StoreEntryEntity)

async function upsertWithExpectedVersion({ projectId, key, value, expectedVersion }: {
    projectId: ProjectId
    key: string
    value: unknown
    expectedVersion: number
}): Promise<UpsertWithVersionResult> {
    const ds = databaseConnection()
    const sanitized = sanitizeObjectForPostgresql(value)
    const payload = JSON.stringify(sanitized)

    if (expectedVersion === 0) {
        try {
            const inserted = await ds.query(
                `INSERT INTO "store-entry" ("id","projectId","key","value","version","created","updated")
                 VALUES ($1,$2,$3,$4::jsonb,1,NOW(),NOW())
                 RETURNING "id","version"`,
                [apId(), projectId, key, payload],
            )
            if (inserted.length > 0) {
                return { status: 'ok', newVersion: Number(inserted[0].version) }
            }
        }
        catch (err) {
            const uniqueViolation = (err as { code?: string }).code === '23505'
            if (!uniqueViolation) throw err
        }
    }

    const updated = await ds.query(
        `UPDATE "store-entry"
         SET "value" = $1::jsonb, "version" = "version" + 1, "updated" = NOW()
         WHERE "projectId" = $2 AND "key" = $3 AND "version" = $4
         RETURNING "version"`,
        [payload, projectId, key, expectedVersion],
    )
    if (updated.length > 0) {
        return { status: 'ok', newVersion: Number(updated[0].version) }
    }

    const current = await ds.query(
        'SELECT "version" FROM "store-entry" WHERE "projectId" = $1 AND "key" = $2',
        [projectId, key],
    )
    commandLayerMetrics.recordCasConflict()
    return {
        status: 'conflict',
        currentVersion: current.length > 0 ? Number(current[0].version) : 0,
    }
}

export const storeEntryService = {
    async upsert({ projectId, request }: { projectId: ProjectId, request: PutStoreEntryRequest }): Promise<StoreEntry | null> {
        const value = sanitizeObjectForPostgresql(request.value)
        const insertResult = await storeEntryRepo().upsert({
            id: apId(),
            key: request.key,
            value,
            projectId,
        }, ['projectId', 'key'])

        return {
            projectId,
            key: request.key,
            value,
            id: insertResult.identifiers[0].id,
            created: insertResult.generatedMaps[0].created,
            updated: insertResult.generatedMaps[0].updated,
        }
    },
    async getOne({
        projectId,
        key,
    }: {
        projectId: ProjectId
        key: string
    }): Promise<StoreEntry | null> {
        return storeEntryRepo().findOneBy({
            projectId,
            key,
        })
    },
    async getOneWithVersion({ projectId, key }: { projectId: ProjectId, key: string }): Promise<(StoreEntry & { version: number }) | null> {
        const ds = databaseConnection()
        const rows = await ds.query(
            `SELECT "id","projectId","key","value","version","created","updated"
             FROM "store-entry" WHERE "projectId" = $1 AND "key" = $2`,
            [projectId, key],
        )
        if (rows.length === 0) return null
        return {
            id: rows[0].id,
            projectId: rows[0].projectId,
            key: rows[0].key,
            value: rows[0].value,
            version: Number(rows[0].version),
            created: rows[0].created,
            updated: rows[0].updated,
        }
    },
    upsertWithExpectedVersion,
    async delete({
        projectId,
        key,
    }: {
        projectId: ProjectId
        key: string
    }): Promise<void> {
        await storeEntryRepo().delete({
            projectId,
            key,
        })
    },
}

export type UpsertWithVersionResult =
    | { status: 'ok', newVersion: number }
    | { status: 'conflict', currentVersion: number }