import { describe, expect, it } from 'vitest'
import {
    CreateMcpGatewayRequestSchema,
    ListMcpGatewayToolsResponseSchema,
    McpGatewayAuthSchema,
    McpGatewaySchema,
    McpGatewayToolSummarySchema,
    McpGatewayWithoutSensitiveDataSchema,
    UpdateMcpGatewayRequestSchema,
} from '../../../src/lib/automation/mcp-gateway/mcp-gateway'

describe('McpGatewayAuthSchema', () => {
    it('accepts NONE', () => {
        expect(McpGatewayAuthSchema.parse({ type: 'NONE' })).toEqual({ type: 'NONE' })
    })

    it('accepts BEARER with a token', () => {
        const input = { type: 'BEARER', token: 'sk-abc' }
        expect(McpGatewayAuthSchema.parse(input)).toEqual(input)
    })

    it('rejects BEARER without token', () => {
        expect(() => McpGatewayAuthSchema.parse({ type: 'BEARER' })).toThrow()
    })

    it('rejects BEARER with empty token', () => {
        expect(() => McpGatewayAuthSchema.parse({ type: 'BEARER', token: '' })).toThrow()
    })

    it('accepts API_KEY with headerName + key', () => {
        const input = { type: 'API_KEY', headerName: 'X-Api-Key', key: 'abc' }
        expect(McpGatewayAuthSchema.parse(input)).toEqual(input)
    })

    it('rejects API_KEY missing key', () => {
        expect(() => McpGatewayAuthSchema.parse({ type: 'API_KEY', headerName: 'X-Api-Key' })).toThrow()
    })

    it('accepts HEADER with headerName + headerValue', () => {
        const input = { type: 'HEADER', headerName: 'X-Custom', headerValue: 'v' }
        expect(McpGatewayAuthSchema.parse(input)).toEqual(input)
    })

    it('rejects unknown auth type', () => {
        expect(() => McpGatewayAuthSchema.parse({ type: 'OAUTH2', token: 'x' })).toThrow()
    })
})

describe('McpGatewaySchema', () => {
    const now = new Date().toISOString()
    const validGateway = {
        id: 'abc123DEF456ghi789JKL',
        created: now,
        updated: now,
        platformId: 'mno456PQR789stu012VWX',
        name: 'Banking Gateway',
        url: 'https://mcp.example.com/rpc',
        description: 'Internal banking MCP',
        auth: { type: 'BEARER', token: 'tok' },
    }

    it('parses a valid gateway', () => {
        expect(McpGatewaySchema.parse(validGateway)).toEqual(validGateway)
    })

    it('rejects invalid URL', () => {
        expect(() => McpGatewaySchema.parse({ ...validGateway, url: 'not-a-url' })).toThrow()
    })

    it('rejects empty name', () => {
        expect(() => McpGatewaySchema.parse({ ...validGateway, name: '' })).toThrow()
    })

    it('rejects name over 120 chars', () => {
        expect(() => McpGatewaySchema.parse({ ...validGateway, name: 'x'.repeat(121) })).toThrow()
    })

    it('allows null description', () => {
        const parsed = McpGatewaySchema.parse({ ...validGateway, description: null })
        expect(parsed.description).toBeNull()
    })
})

describe('McpGatewayWithoutSensitiveDataSchema', () => {
    const now = new Date().toISOString()

    it('strips BEARER token on serialisation', () => {
        const publicShape = {
            id: 'abc123DEF456ghi789JKL',
            created: now,
            updated: now,
            platformId: 'mno456PQR789stu012VWX',
            name: 'x',
            url: 'https://x.example',
            auth: { type: 'BEARER' },
        }
        expect(McpGatewayWithoutSensitiveDataSchema.parse(publicShape).auth).toEqual({ type: 'BEARER' })
    })

    it('keeps headerName for API_KEY but hides key', () => {
        const publicShape = {
            id: 'abc123DEF456ghi789JKL',
            created: now,
            updated: now,
            platformId: 'mno456PQR789stu012VWX',
            name: 'x',
            url: 'https://x.example',
            auth: { type: 'API_KEY', headerName: 'X-Api-Key' },
        }
        const parsed = McpGatewayWithoutSensitiveDataSchema.parse(publicShape)
        expect(parsed.auth).toEqual({ type: 'API_KEY', headerName: 'X-Api-Key' })
    })

    it('keeps headerName for HEADER but hides headerValue', () => {
        const publicShape = {
            id: 'abc123DEF456ghi789JKL',
            created: now,
            updated: now,
            platformId: 'mno456PQR789stu012VWX',
            name: 'x',
            url: 'https://x.example',
            auth: { type: 'HEADER', headerName: 'X-Custom' },
        }
        const parsed = McpGatewayWithoutSensitiveDataSchema.parse(publicShape)
        expect(parsed.auth).toEqual({ type: 'HEADER', headerName: 'X-Custom' })
    })
})

describe('CreateMcpGatewayRequestSchema', () => {
    it('requires name, url, auth', () => {
        const valid = {
            name: 'g',
            url: 'https://g.example',
            auth: { type: 'NONE' },
        }
        expect(CreateMcpGatewayRequestSchema.parse(valid)).toEqual(valid)
    })

    it('rejects missing url', () => {
        expect(() => CreateMcpGatewayRequestSchema.parse({
            name: 'g',
            auth: { type: 'NONE' },
        })).toThrow()
    })

    it('accepts optional description', () => {
        const parsed = CreateMcpGatewayRequestSchema.parse({
            name: 'g',
            url: 'https://g.example',
            auth: { type: 'NONE' },
            description: 'notes',
        })
        expect(parsed.description).toBe('notes')
    })
})

describe('UpdateMcpGatewayRequestSchema', () => {
    it('accepts empty body (all fields optional)', () => {
        expect(UpdateMcpGatewayRequestSchema.parse({})).toEqual({})
    })

    it('accepts partial update', () => {
        const parsed = UpdateMcpGatewayRequestSchema.parse({ name: 'renamed' })
        expect(parsed.name).toBe('renamed')
    })

    it('validates nested auth when provided', () => {
        expect(() => UpdateMcpGatewayRequestSchema.parse({ auth: { type: 'BEARER' } })).toThrow()
    })

    it('accepts null description to clear it', () => {
        expect(UpdateMcpGatewayRequestSchema.parse({ description: null }).description).toBeNull()
    })
})

describe('McpGatewayToolSummarySchema + ListMcpGatewayToolsResponseSchema', () => {
    it('parses a minimal tool', () => {
        expect(McpGatewayToolSummarySchema.parse({ name: 'search' })).toEqual({ name: 'search' })
    })

    it('accepts description and inputSchema', () => {
        const t = {
            name: 'search',
            description: 'Search something',
            inputSchema: { type: 'object' },
        }
        expect(McpGatewayToolSummarySchema.parse(t)).toEqual(t)
    })

    it('wraps tools in a list response', () => {
        const resp = { tools: [{ name: 'a' }, { name: 'b' }] }
        expect(ListMcpGatewayToolsResponseSchema.parse(resp)).toEqual(resp)
    })
})
