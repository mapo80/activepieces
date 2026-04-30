import { createHmac, timingSafeEqual } from 'node:crypto'
import { safeHttp } from '@activepieces/server-utils'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { z } from 'zod'
import { securityAccess } from '../core/security/authorization/fastify-security'

export const toolsInvokeController: FastifyPluginAsyncZod = async (app) => {
    app.post('/tools/invoke', InvokeRoute, async (request, reply) => {
        const javaUrl = process.env['AP_AGENTIC_PROVIDER_URL'] ?? DEFAULT_PROVIDER_URL
        const javaApiKey = process.env['AP_AGENTIC_PROVIDER_API_KEY'] ?? ''
        const webhookSecret = process.env['AP_AGENTIC_WEBHOOK_SECRET'] ?? ''

        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (javaApiKey) {
            headers['Authorization'] = `Bearer ${javaApiKey}`
        }

        const rawBody = JSON.stringify(request.body)
        if (webhookSecret.length > 0) {
            headers[SIGNATURE_HEADER] = signHmac(rawBody, webhookSecret)
        }

        try {
            const response = await safeHttp.axios.post(
                `${javaUrl}/agentic/v1/tools/invoke`,
                rawBody,
                {
                    timeout: PROXY_TIMEOUT_MS,
                    headers,
                    validateStatus: () => true,
                    transformRequest: [(data) => data],
                },
            )
            await reply.status(response.status).send(response.data)
        }
        catch (err) {
            request.log.error({ err, javaUrl }, '[agentic/tools/invoke] proxy error')
            await reply.status(StatusCodes.BAD_GATEWAY).send({
                error: 'agentic-provider-unavailable',
                message: (err as Error).message,
            })
        }
    })
}

function signHmac(payload: string, secret: string): string {
    const mac = createHmac('sha256', secret)
    mac.update(payload, 'utf8')
    return `sha256=${mac.digest('hex')}`
}

export function verifyHmac(payload: string, secret: string, header: string | undefined): boolean {
    if (!header || !header.startsWith('sha256=')) return false
    const expected = signHmac(payload, secret)
    const a = Buffer.from(expected, 'utf8')
    const b = Buffer.from(header, 'utf8')
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
}

const DEFAULT_PROVIDER_URL = 'http://localhost:8090'
const PROXY_TIMEOUT_MS = 60_000
const SIGNATURE_HEADER = 'X-AP-Signature'

const InvokeRequestSchema = z.object({
    mcpGatewayId: z.string().min(1),
    toolRef: z.string().min(1),
    version: z.string().min(1).optional(),
    payload: z.record(z.string(), z.unknown()),
    idempotencyKey: z.string().min(1),
    effect: z.enum(['PURE', 'READ', 'IDEMPOTENT', 'COMPENSATABLE', 'IRREVERSIBLE']),
    runContext: z.object({
        platformRunId: z.string().min(1),
        capabilityId: z.string().min(1),
        tenantId: z.string().min(1),
    }),
})

const InvokeResponseSchema = z.object({
    outcome: z.enum(['SUCCESS', 'ERROR', 'IDEMPOTENT_REPLAY']),
    outputs: z.record(z.string(), z.unknown()).optional(),
    latencyMs: z.number().optional(),
    retries: z.number().optional(),
    errorCode: z.string().optional(),
    errorMessage: z.string().optional(),
})

const InvokeRoute = {
    config: {
        security: securityAccess.engine(),
    },
    schema: {
        tags: ['agentic'],
        body: InvokeRequestSchema,
        response: {
            [StatusCodes.OK]: InvokeResponseSchema,
            [StatusCodes.BAD_GATEWAY]: z.object({
                error: z.string(),
                message: z.string(),
            }),
        },
    },
}

export type AgenticToolInvokeRequest = z.infer<typeof InvokeRequestSchema>
export type AgenticToolInvokeResponse = z.infer<typeof InvokeResponseSchema>
