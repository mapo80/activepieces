import { McpGateway } from '@activepieces/shared'
import { EntitySchema } from 'typeorm'
import { BaseColumnSchemaPart } from '../database/database-common'
import { EncryptedObject } from '../helper/encryption'

export type McpGatewaySchema = Omit<McpGateway, 'auth'> & {
    auth: EncryptedObject
}

export const McpGatewayEntity = new EntitySchema<McpGatewaySchema>({
    name: 'mcp_gateway',
    columns: {
        ...BaseColumnSchemaPart,
        platformId: {
            type: String,
            nullable: false,
        },
        name: {
            type: String,
            nullable: false,
        },
        url: {
            type: String,
            nullable: false,
        },
        description: {
            type: String,
            nullable: true,
        },
        auth: {
            type: 'jsonb',
            nullable: false,
        },
    },
    indices: [
        {
            name: 'idx_mcp_gateway_platform_id',
            columns: ['platformId'],
        },
        {
            name: 'idx_mcp_gateway_platform_id_name',
            columns: ['platformId', 'name'],
            unique: true,
        },
    ],
})
