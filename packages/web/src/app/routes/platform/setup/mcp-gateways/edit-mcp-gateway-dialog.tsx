import {
  CreateMcpGatewayRequest,
  McpGatewayAuth,
  McpGatewayWithoutSensitiveData,
  UpdateMcpGatewayRequest,
} from '@activepieces/shared';
import { t } from 'i18next';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { mcpGatewaysMutations } from '@/features/mcp-gateways/lib/mcp-gateways-hooks';

import { McpGatewayForm, McpGatewayFormValues } from './mcp-gateway-form';

type EditMcpGatewayDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing?: McpGatewayWithoutSensitiveData;
};

export function EditMcpGatewayDialog({
  open,
  onOpenChange,
  existing,
}: EditMcpGatewayDialogProps) {
  const mode = existing ? 'edit' : 'create';
  const [serverError, setServerError] = useState<string | undefined>(undefined);

  const { mutate: createGateway, isPending: isCreating } =
    mcpGatewaysMutations.useCreate({
      onSuccess: () => {
        toast.success(t('MCP gateway created'));
        onOpenChange(false);
      },
      onError: (error) => {
        setServerError(error.message);
      },
    });

  const { mutate: updateGateway, isPending: isUpdating } =
    mcpGatewaysMutations.useUpdate({
      onSuccess: () => {
        toast.success(t('MCP gateway updated'));
        onOpenChange(false);
      },
      onError: (error) => {
        setServerError(error.message);
      },
    });

  const handleSubmit = (values: McpGatewayFormValues) => {
    setServerError(undefined);
    const auth = buildAuth(values);
    if (mode === 'create') {
      const request: CreateMcpGatewayRequest = {
        name: values.name,
        url: values.url,
        description: values.description || undefined,
        auth,
      };
      createGateway({ request });
      return;
    }
    const request: UpdateMcpGatewayRequest = {
      name: values.name,
      url: values.url,
      description: values.description === '' ? null : values.description,
      auth: shouldSendAuth(values, existing) ? auth : undefined,
    };
    updateGateway({ id: existing!.id, request });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? t('New MCP Gateway') : t('Edit MCP Gateway')}
          </DialogTitle>
          <DialogDescription>
            {t('Configure a remote MCP gateway for flows on this platform.')}
          </DialogDescription>
        </DialogHeader>
        <McpGatewayForm
          key={open ? existing?.id ?? 'new' : 'closed'}
          mode={mode}
          existing={existing}
          isSubmitting={isCreating || isUpdating}
          serverError={serverError}
          onCancel={() => onOpenChange(false)}
          onSubmit={handleSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}

function buildAuth(values: McpGatewayFormValues): McpGatewayAuth {
  switch (values.authType) {
    case 'NONE':
      return { type: 'NONE' };
    case 'BEARER':
      return { type: 'BEARER', token: values.token ?? '' };
    case 'API_KEY':
      return {
        type: 'API_KEY',
        headerName: values.headerName ?? '',
        key: values.apiKey ?? '',
      };
    case 'HEADER':
      return {
        type: 'HEADER',
        headerName: values.headerName ?? '',
        headerValue: values.headerValue ?? '',
      };
  }
}

function shouldSendAuth(
  values: McpGatewayFormValues,
  existing?: McpGatewayWithoutSensitiveData,
): boolean {
  if (!existing) return true;
  const existingAuth = existing.auth;
  if (existingAuth.type !== values.authType) return true;
  switch (values.authType) {
    case 'NONE':
      return false;
    case 'BEARER':
      return Boolean(values.token);
    case 'API_KEY':
      return (
        Boolean(values.apiKey) ||
        (existingAuth.type === 'API_KEY' &&
          existingAuth.headerName !== values.headerName)
      );
    case 'HEADER':
      return (
        Boolean(values.headerValue) ||
        (existingAuth.type === 'HEADER' &&
          existingAuth.headerName !== values.headerName)
      );
  }
}
