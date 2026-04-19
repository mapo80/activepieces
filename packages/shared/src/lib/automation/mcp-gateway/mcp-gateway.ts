import { z } from 'zod'
import { BaseModelSchema } from '../../core/common/base-model'
import { ApId } from '../../core/common/id-generator'

const McpGatewayNoneAuthSchema = z.object({
    type: z.enum(['NONE']),
})

const McpGatewayBearerAuthSchema = z.object({
    type: z.enum(['BEARER']),
    token: z.string().min(1),
})

const McpGatewayApiKeyAuthSchema = z.object({
    type: z.enum(['API_KEY']),
    headerName: z.string().min(1),
    key: z.string().min(1),
})

const McpGatewayCustomHeaderAuthSchema = z.object({
    type: z.enum(['HEADER']),
    headerName: z.string().min(1),
    headerValue: z.string().min(1),
})

export const McpGatewayAuthSchema = z.discriminatedUnion('type', [
    McpGatewayNoneAuthSchema,
    McpGatewayBearerAuthSchema,
    McpGatewayApiKeyAuthSchema,
    McpGatewayCustomHeaderAuthSchema,
])

export const McpGatewaySchema = z.object({
    ...BaseModelSchema,
    platformId: ApId,
    name: z.string().min(1).max(120),
    url: z.string().url(),
    description: z.string().max(500).nullable().optional(),
    auth: McpGatewayAuthSchema,
})

const McpGatewayAuthPublicSchema = z.discriminatedUnion('type', [
    McpGatewayNoneAuthSchema,
    z.object({
        type: z.enum(['BEARER']),
    }),
    z.object({
        type: z.enum(['API_KEY']),
        headerName: z.string(),
    }),
    z.object({
        type: z.enum(['HEADER']),
        headerName: z.string(),
    }),
])

export const McpGatewayWithoutSensitiveDataSchema = McpGatewaySchema.extend({
    auth: McpGatewayAuthPublicSchema,
})

export const CreateMcpGatewayRequestSchema = z.object({
    name: z.string().min(1).max(120),
    url: z.string().url(),
    description: z.string().max(500).optional(),
    auth: McpGatewayAuthSchema,
})

export const UpdateMcpGatewayRequestSchema = z.object({
    name: z.string().min(1).max(120).optional(),
    url: z.string().url().optional(),
    description: z.string().max(500).nullable().optional(),
    auth: McpGatewayAuthSchema.optional(),
})

export const McpGatewayToolSummarySchema = z.object({
    name: z.string(),
    description: z.string().optional(),
    inputSchema: z.unknown().optional(),
})

export const ListMcpGatewayToolsResponseSchema = z.object({
    tools: z.array(McpGatewayToolSummarySchema),
})

export const ResolveMcpGatewayResponseSchema = z.object({
    url: z.string().url(),
    headers: z.record(z.string(), z.string()),
})

export const McpGatewayToolDiffRequestSchema = z.object({
    tools: z.array(z.object({
        name: z.string().min(1),
        snapshot: z.unknown().optional(),
    })).min(1),
})

export const McpGatewayToolDiffEntrySchema = z.object({
    name: z.string(),
    status: z.enum(['OK', 'DRIFTED', 'REMOVED']),
    liveSchema: z.unknown().optional(),
})

export const McpGatewayToolDiffResponseSchema = z.object({
    results: z.array(McpGatewayToolDiffEntrySchema),
})

export type McpGatewayId = string
export type McpGatewayAuthType = 'NONE' | 'BEARER' | 'API_KEY' | 'HEADER'
export type McpGatewayAuth = z.infer<typeof McpGatewayAuthSchema>
export type McpGateway = z.infer<typeof McpGatewaySchema>
export type McpGatewayWithoutSensitiveData = z.infer<typeof McpGatewayWithoutSensitiveDataSchema>
export type CreateMcpGatewayRequest = z.infer<typeof CreateMcpGatewayRequestSchema>
export type UpdateMcpGatewayRequest = z.infer<typeof UpdateMcpGatewayRequestSchema>
export type McpGatewayToolSummary = z.infer<typeof McpGatewayToolSummarySchema>
export type ListMcpGatewayToolsResponse = z.infer<typeof ListMcpGatewayToolsResponseSchema>
export type ResolveMcpGatewayResponse = z.infer<typeof ResolveMcpGatewayResponseSchema>
export type McpGatewayToolDiffRequest = z.infer<typeof McpGatewayToolDiffRequestSchema>
export type McpGatewayToolDiffEntry = z.infer<typeof McpGatewayToolDiffEntrySchema>
export type McpGatewayToolDiffResponse = z.infer<typeof McpGatewayToolDiffResponseSchema>
