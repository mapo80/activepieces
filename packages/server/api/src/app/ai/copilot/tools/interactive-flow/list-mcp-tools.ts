import { z } from 'zod'
import { FastifyBaseLogger } from 'fastify'
import { CopilotContext, CopilotTool } from '../../scope-registry'
import { mcpGatewayService } from '../../../../mcp-gateway/mcp-gateway.service'

const Parameters = z.object({
    gatewayId: z.string().optional().describe('MCP gateway id. If omitted, uses the current flow context gateway.'),
})

export function buildListMcpToolsTool(log: FastifyBaseLogger): CopilotTool {
    return {
        description: 'Lists the MCP tools available on the gateway. Call this BEFORE binding any TOOL node; never guess tool names. Returns an array of {name, snapshot}.',
        parameters: Parameters,
        isMutation: false,
        execute: async (rawArgs, ctx: CopilotContext) => {
            const args = Parameters.parse(rawArgs)
            const gatewayId = args.gatewayId ?? ctx.gatewayId
            if (!gatewayId) {
                return { tools: [], warning: 'No MCP gateway bound to this flow. Provide mcpGatewayId via set_message_input first or pass it explicitly.' }
            }
            try {
                const svc = mcpGatewayService(log)
                const response = await svc.listTools({ id: gatewayId, platformId: ctx.platformId })
                return { tools: response.tools }
            }
            catch (err) {
                return { tools: [], error: (err as Error).message }
            }
        },
    }
}
