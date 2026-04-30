import { APIRequestContext } from '@playwright/test';

const MCP_MOCK_URL = process.env.MCP_GATEWAY_URL ?? 'http://localhost:8000/mcp';

export const mcpMockControl = {
  reachable: async (request: APIRequestContext): Promise<boolean> => {
    try {
      const res = await request.get(MCP_MOCK_URL, { timeout: 3_000 });
      return res.status() < 500;
    } catch {
      return false;
    }
  },
  url: () => MCP_MOCK_URL,
};
