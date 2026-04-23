import { FastifyBaseLogger } from 'fastify'
import { z } from 'zod'
import { mcpGatewayService } from '../../../../mcp-gateway/mcp-gateway.service'
import { CopilotContext, CopilotTool } from '../../scope-registry'

const Parameters = z.object({})

export function buildListMcpGatewaysTool(log: FastifyBaseLogger): CopilotTool {
    return {
        description: 'Lists all MCP gateways available to the current platform. Returns an array of {id, name, url}. Call this BEFORE scaffolding the INTERACTIVE_FLOW to obtain the mcpGatewayId to bind. Typically pick the first one returned unless the user specified otherwise.',
        parameters: Parameters,
        isMutation: false,
        execute: async (_rawArgs, ctx: CopilotContext) => {
            try {
                const gateways = await mcpGatewayService(log).list({ platformId: ctx.platformId })
                return {
                    gateways: gateways.map((g) => ({ id: g.id, name: g.name, url: g.url })),
                }
            }
            catch (err) {
                return { gateways: [], error: (err as Error).message }
            }
        },
    }
}
