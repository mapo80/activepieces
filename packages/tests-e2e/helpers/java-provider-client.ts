import { APIRequestContext } from '@playwright/test';

const PROVIDER_URL = process.env.AP_AGENTIC_PROVIDER_URL ?? 'http://localhost:8090';

export type ToolInvokeRequest = {
  mcpGatewayId: string;
  toolRef: string;
  version: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  effect: 'PURE' | 'READ' | 'IDEMPOTENT' | 'COMPENSATABLE' | 'IRREVERSIBLE';
  runContext?: Record<string, unknown>;
};

export type ToolInvokeResponse = {
  outcome: 'SUCCESS' | 'ERROR' | 'IDEMPOTENT_REPLAY';
  outputs: Record<string, unknown>;
  latencyMs: number;
  retries?: number;
  errorCode?: string;
  errorMessage?: string;
};

export const javaProviderClient = {
  invokeTool: async (
    request: APIRequestContext,
    body: ToolInvokeRequest,
  ): Promise<{ status: number; body: ToolInvokeResponse | { error: string } }> => {
    const res = await request.post(`${PROVIDER_URL}/agentic/v1/tools/invoke`, {
      data: body,
      timeout: 30_000,
    });
    return { status: res.status(), body: await res.json() };
  },
  health: async (request: APIRequestContext): Promise<boolean> => {
    try {
      const res = await request.get(`${PROVIDER_URL}/health`, { timeout: 5_000 });
      return res.ok();
    } catch {
      return false;
    }
  },
  diagSnapshot: async (
    request: APIRequestContext,
  ): Promise<{ ok: boolean; status: number; body: Record<string, unknown> | null }> => {
    try {
      const res = await request.get(`${PROVIDER_URL}/agentic/v1/diag/snapshot`, {
        timeout: 5_000,
      });
      const status = res.status();
      const body = status === 200 ? await res.json() : null;
      return { ok: status === 200, status, body };
    } catch {
      return { ok: false, status: 0, body: null };
    }
  },
};
