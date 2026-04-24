import { STORE_KEY_MAX_LENGTH, StoreEntry } from '@activepieces/shared'
import { EntitySchema } from 'typeorm'
import {
    ApIdSchema,
    BaseColumnSchemaPart,
} from '../database/database-common'

type StoreEntrySchema = StoreEntry & {
    version: string
}

export const StoreEntryEntity = new EntitySchema<StoreEntrySchema>({
    name: 'store-entry',
    columns: {
        ...BaseColumnSchemaPart,
        key: {
            type: String,
            length: STORE_KEY_MAX_LENGTH,
        },
        projectId: ApIdSchema,
        value: {
            type: 'jsonb',
            nullable: true,
        },
        version: {
            type: 'bigint',
            nullable: false,
            default: 0,
        },
    },
    uniques: [
        {
            columns: ['projectId', 'key'],
        },
    ],
})
