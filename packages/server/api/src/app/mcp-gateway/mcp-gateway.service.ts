import {
    ActivepiecesError,
    apId,
    CreateMcpGatewayRequest,
    ErrorCode,
    isNil,
    ListMcpGatewayToolsResponse,
    McpGateway,
    McpGatewayAuth,
    McpGatewayToolSummary,
    McpGatewayWithoutSensitiveData,
    UpdateMcpGatewayRequest,
} from '@activepieces/shared'
import { FastifyBaseLogger } from 'fastify'
import { lru } from 'tiny-lru'
import { repoFactory } from '../core/db/repo-factory'
import { encryptUtils } from '../helper/encryption'
import { McpGatewayEntity, McpGatewaySchema } from './mcp-gateway.entity'

const TOOL_CACHE_MAX_ENTRIES = 256
const TOOL_CACHE_TTL_MS = 60_000

export const mcpGatewaysRepo = repoFactory(McpGatewayEntity)
const toolListCache = lru<ListMcpGatewayToolsResponse>(TOOL_CACHE_MAX_ENTRIES, TOOL_CACHE_TTL_MS)

export const mcpGatewayService = (log: FastifyBaseLogger) => ({
    async create({ platformId, request }: { platformId: string, request: CreateMcpGatewayRequest }): Promise<McpGatewayWithoutSensitiveData> {
        await assertNameIsUnique({ platformId, name: request.name })
        const id = apId()
        const auth = await encryptUtils.encryptObject(request.auth)
        await mcpGatewaysRepo().insert({
            id,
            platformId,
            name: request.name,
            url: request.url,
            description: request.description ?? null,
            auth,
        })
        return toPublicOrThrow({ platformId, id })
    },

    async list({ platformId }: { platformId: string }): Promise<McpGatewayWithoutSensitiveData[]> {
        const records = await mcpGatewaysRepo().find({
            where: { platformId },
            order: { created: 'DESC' },
        })
        return Promise.all(records.map(toPublic))
    },

    async get({ id, platformId }: { id: string, platformId: string }): Promise<McpGatewayWithoutSensitiveData> {
        return toPublicOrThrow({ platformId, id })
    },

    async update({ id, platformId, request }: { id: string, platformId: string, request: UpdateMcpGatewayRequest }): Promise<McpGatewayWithoutSensitiveData> {
        const existing = await getOrThrow({ id, platformId })
        if (!isNil(request.name) && request.name !== existing.name) {
            await assertNameIsUnique({ platformId, name: request.name })
        }
        const auth = isNil(request.auth) ? existing.auth : await encryptUtils.encryptObject(request.auth)
        await mcpGatewaysRepo().update({ id, platformId }, {
            ...(isNil(request.name) ? {} : { name: request.name }),
            ...(isNil(request.url) ? {} : { url: request.url }),
            ...(request.description === undefined ? {} : { description: request.description ?? null }),
            auth,
        })
        toolListCache.delete(id)
        return toPublicOrThrow({ platformId, id })
    },

    async delete({ id, platformId }: { id: string, platformId: string }): Promise<void> {
        const { affected } = await mcpGatewaysRepo().delete({ id, platformId })
        if (affected === 0) {
            throw notFound(id)
        }
        toolListCache.delete(id)
    },

    async getResolved({ id, platformId }: { id: string, platformId: string }): Promise<McpGateway> {
        const record = await getOrThrow({ id, platformId })
        return decryptRecord(record)
    },

    async listTools({ id, platformId }: { id: string, platformId: string }): Promise<ListMcpGatewayToolsResponse> {
        const cached = toolListCache.get(id)
        if (!isNil(cached)) {
            return cached
        }
        const resolved = await this.getResolved({ id, platformId })
        const response = await fetchToolsFromGateway({ url: resolved.url, auth: resolved.auth, log })
        toolListCache.set(id, response)
        return response
    },
})

async function assertNameIsUnique({ platformId, name }: { platformId: string, name: string }): Promise<void> {
    const existing = await mcpGatewaysRepo().findOne({ where: { platformId, name } })
    if (!isNil(existing)) {
        throw new ActivepiecesError({
            code: ErrorCode.VALIDATION,
            params: { message: `An MCP gateway with name "${name}" already exists` },
        })
    }
}

async function getOrThrow({ id, platformId }: { id: string, platformId: string }): Promise<McpGatewaySchema> {
    const record = await mcpGatewaysRepo().findOne({ where: { id, platformId } })
    if (isNil(record)) {
        throw notFound(id)
    }
    return record
}

async function toPublicOrThrow({ platformId, id }: { platformId: string, id: string }): Promise<McpGatewayWithoutSensitiveData> {
    const record = await getOrThrow({ id, platformId })
    return toPublic(record)
}

async function toPublic(record: McpGatewaySchema): Promise<McpGatewayWithoutSensitiveData> {
    const auth = await encryptUtils.decryptObject<McpGatewayAuth>(record.auth)
    return {
        id: record.id,
        created: record.created,
        updated: record.updated,
        platformId: record.platformId,
        name: record.name,
        url: record.url,
        description: record.description ?? null,
        auth: stripSecrets(auth),
    }
}

async function decryptRecord(record: McpGatewaySchema): Promise<McpGateway> {
    const auth = await encryptUtils.decryptObject<McpGatewayAuth>(record.auth)
    return {
        id: record.id,
        created: record.created,
        updated: record.updated,
        platformId: record.platformId,
        name: record.name,
        url: record.url,
        description: record.description ?? null,
        auth,
    }
}

function stripSecrets(auth: McpGatewayAuth): McpGatewayWithoutSensitiveData['auth'] {
    switch (auth.type) {
        case 'NONE':
            return { type: 'NONE' }
        case 'BEARER':
            return { type: 'BEARER' }
        case 'API_KEY':
            return { type: 'API_KEY', headerName: auth.headerName }
        case 'HEADER':
            return { type: 'HEADER', headerName: auth.headerName }
    }
}

function notFound(id: string): ActivepiecesError {
    return new ActivepiecesError({
        code: ErrorCode.ENTITY_NOT_FOUND,
        params: { message: 'MCP gateway not found', entityType: 'mcp_gateway', entityId: id },
    })
}

async function fetchToolsFromGateway({ url, auth, log }: { url: string, auth: McpGatewayAuth, log: FastifyBaseLogger }): Promise<ListMcpGatewayToolsResponse> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    applyAuthHeaders(headers, auth)

    let response: Response
    try {
        response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/list',
                params: {},
            }),
        })
    }
    catch (error) {
        log.warn({ err: error, url }, '[mcpGatewayService#listTools] gateway unreachable')
        throw new ActivepiecesError({
            code: ErrorCode.VALIDATION,
            params: { message: `MCP gateway unreachable: ${(error as Error).message}` },
        })
    }

    if (!response.ok) {
        throw new ActivepiecesError({
            code: ErrorCode.VALIDATION,
            params: { message: `MCP gateway returned HTTP ${response.status}` },
        })
    }

    const body = await response.json().catch(() => null) as unknown
    const tools = parseToolsList(body)
    if (isNil(tools)) {
        throw new ActivepiecesError({
            code: ErrorCode.VALIDATION,
            params: { message: 'MCP gateway returned an invalid tools/list response' },
        })
    }
    return { tools }
}

function applyAuthHeaders(headers: Record<string, string>, auth: McpGatewayAuth): void {
    switch (auth.type) {
        case 'NONE':
            return
        case 'BEARER':
            headers.Authorization = `Bearer ${auth.token}`
            return
        case 'API_KEY':
            headers[auth.headerName] = auth.key
            return
        case 'HEADER':
            headers[auth.headerName] = auth.headerValue
    }
}

function parseToolsList(body: unknown): McpGatewayToolSummary[] | null {
    if (!body || typeof body !== 'object') {
        return null
    }
    const result = (body as { result?: unknown }).result
    if (!result || typeof result !== 'object') {
        return null
    }
    const tools = (result as { tools?: unknown }).tools
    if (!Array.isArray(tools)) {
        return null
    }
    return tools
        .filter((t): t is Record<string, unknown> => !isNil(t) && typeof t === 'object')
        .map((t) => ({
            name: String(t.name ?? ''),
            description: typeof t.description === 'string' ? t.description : undefined,
            inputSchema: t.inputSchema,
        }))
        .filter((t) => t.name.length > 0)
}
