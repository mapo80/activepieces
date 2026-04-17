import {
  CreateMcpGatewayRequest,
  ListMcpGatewayToolsResponse,
  McpGatewayWithoutSensitiveData,
  UpdateMcpGatewayRequest,
} from '@activepieces/shared';

import { api } from '@/lib/api';

export const mcpGatewaysApi = {
  list(): Promise<McpGatewayWithoutSensitiveData[]> {
    return api.get<McpGatewayWithoutSensitiveData[]>('/v1/mcp-gateways');
  },
  get(id: string): Promise<McpGatewayWithoutSensitiveData> {
    return api.get<McpGatewayWithoutSensitiveData>(`/v1/mcp-gateways/${id}`);
  },
  create(
    request: CreateMcpGatewayRequest,
  ): Promise<McpGatewayWithoutSensitiveData> {
    return api.post<McpGatewayWithoutSensitiveData>(
      '/v1/mcp-gateways',
      request,
    );
  },
  update(
    id: string,
    request: UpdateMcpGatewayRequest,
  ): Promise<McpGatewayWithoutSensitiveData> {
    return api.post<McpGatewayWithoutSensitiveData>(
      `/v1/mcp-gateways/${id}`,
      request,
    );
  },
  delete(id: string): Promise<void> {
    return api.delete<void>(`/v1/mcp-gateways/${id}`);
  },
  listTools(id: string): Promise<ListMcpGatewayToolsResponse> {
    return api.post<ListMcpGatewayToolsResponse>(
      `/v1/mcp-gateways/${id}/tools`,
      {},
    );
  },
};
