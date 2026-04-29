import {
  CreateMcpGatewayRequest,
  McpGatewayWithoutSensitiveData,
  UpdateMcpGatewayRequest,
} from '@activepieces/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { mcpGatewaysApi } from './mcp-gateways-api';

const MCP_GATEWAYS_KEY = 'mcpGateways';
const MCP_GATEWAY_TOOLS_KEY = 'mcpGatewayTools';

export const mcpGatewaysQueries = {
  useList: () =>
    useQuery<McpGatewayWithoutSensitiveData[]>({
      queryKey: [MCP_GATEWAYS_KEY],
      queryFn: () => mcpGatewaysApi.list(),
      meta: { showErrorDialog: true, loadSubsetOptions: {} },
    }),

  useTools: (gatewayId: string | null) =>
    useQuery({
      queryKey: [MCP_GATEWAY_TOOLS_KEY, gatewayId],
      queryFn: () => {
        if (!gatewayId) {
          return { tools: [] };
        }
        return mcpGatewaysApi.listTools(gatewayId);
      },
      enabled: Boolean(gatewayId),
    }),
};

type CreateVars = { request: CreateMcpGatewayRequest };
type UpdateVars = { id: string; request: UpdateMcpGatewayRequest };

export const mcpGatewaysMutations = {
  useCreate: (opts?: {
    onSuccess?: (created: McpGatewayWithoutSensitiveData) => void;
    onError?: (error: Error) => void;
  }) => {
    const queryClient = useQueryClient();
    return useMutation<McpGatewayWithoutSensitiveData, Error, CreateVars>({
      mutationFn: ({ request }) => mcpGatewaysApi.create(request),
      onSuccess: (data) => {
        void queryClient.invalidateQueries({ queryKey: [MCP_GATEWAYS_KEY] });
        opts?.onSuccess?.(data);
      },
      onError: (error) => {
        opts?.onError?.(error);
      },
    });
  },

  useUpdate: (opts?: {
    onSuccess?: (updated: McpGatewayWithoutSensitiveData) => void;
    onError?: (error: Error) => void;
  }) => {
    const queryClient = useQueryClient();
    return useMutation<McpGatewayWithoutSensitiveData, Error, UpdateVars>({
      mutationFn: ({ id, request }) => mcpGatewaysApi.update(id, request),
      onSuccess: (data) => {
        void queryClient.invalidateQueries({ queryKey: [MCP_GATEWAYS_KEY] });
        void queryClient.invalidateQueries({
          queryKey: [MCP_GATEWAY_TOOLS_KEY, data.id],
        });
        opts?.onSuccess?.(data);
      },
      onError: (error) => {
        opts?.onError?.(error);
      },
    });
  },

  useDelete: (opts?: {
    onSuccess?: () => void;
    onError?: (error: Error) => void;
  }) => {
    const queryClient = useQueryClient();
    return useMutation<void, Error, string>({
      mutationFn: (id) => mcpGatewaysApi.delete(id),
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: [MCP_GATEWAYS_KEY] });
        opts?.onSuccess?.();
      },
      onError: (error) => {
        opts?.onError?.(error);
      },
    });
  },
};
