import {
  McpGatewayWithoutSensitiveData,
  PlatformRole,
} from '@activepieces/shared';
import { t } from 'i18next';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { CenteredPage } from '@/app/components/centered-page';
import { ConfirmationDeleteDialog } from '@/components/custom/delete-dialog';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  mcpGatewaysMutations,
  mcpGatewaysQueries,
} from '@/features/mcp-gateways/lib/mcp-gateways-hooks';
import { userHooks } from '@/hooks/user-hooks';

import { EditMcpGatewayDialog } from './edit-mcp-gateway-dialog';

export default function McpGatewaysPage() {
  const { data: currentUser } = userHooks.useCurrentUser();
  const { data: gateways, isLoading } = mcpGatewaysQueries.useList();
  const [editing, setEditing] = useState<{
    open: boolean;
    gateway?: McpGatewayWithoutSensitiveData;
  }>({ open: false });
  const [pendingDelete, setPendingDelete] =
    useState<McpGatewayWithoutSensitiveData | null>(null);

  const { mutate: deleteGateway, isPending: isDeleting } =
    mcpGatewaysMutations.useDelete({
      onSuccess: () => {
        toast.success(t('MCP gateway deleted'));
        setPendingDelete(null);
      },
      onError: (error) => toast.error(error.message),
    });

  if (currentUser?.platformRole !== PlatformRole.ADMIN) {
    return (
      <CenteredPage title={t('MCP Gateways')} description="">
        <div className="text-muted-foreground text-sm">
          {t('Only platform admins can manage MCP gateways.')}
        </div>
      </CenteredPage>
    );
  }

  return (
    <>
      <CenteredPage
        title={t('MCP Gateways')}
        description={t(
          'Register remote Model Context Protocol gateways that flows on this platform can call.',
        )}
        actions={
          <Button
            size="sm"
            onClick={() => setEditing({ open: true, gateway: undefined })}
          >
            <Plus className="size-4 mr-1" />
            {t('New gateway')}
          </Button>
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('Name')}</TableHead>
              <TableHead>{t('URL')}</TableHead>
              <TableHead>{t('Authentication')}</TableHead>
              <TableHead className="w-[100px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="text-center text-muted-foreground"
                >
                  {t('Loading…')}
                </TableCell>
              </TableRow>
            )}
            {!isLoading && (!gateways || gateways.length === 0) && (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="text-center text-muted-foreground py-6"
                >
                  {t('No MCP gateways configured yet.')}
                </TableCell>
              </TableRow>
            )}
            {gateways?.map((gateway) => (
              <TableRow key={gateway.id}>
                <TableCell className="font-medium">{gateway.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {gateway.url}
                </TableCell>
                <TableCell>{t(gateway.auth.type)}</TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setEditing({ open: true, gateway })}
                    aria-label={t('Edit')}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setPendingDelete(gateway)}
                    aria-label={t('Delete')}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CenteredPage>

      <EditMcpGatewayDialog
        open={editing.open}
        onOpenChange={(open) =>
          setEditing({ open, gateway: open ? editing.gateway : undefined })
        }
        existing={editing.gateway}
      />

      <ConfirmationDeleteDialog
        title={t('Delete MCP gateway')}
        message={t(
          'This will remove the gateway. Flows referencing it will stop working until reconfigured.',
        )}
        entityName={pendingDelete?.name ?? ''}
        mutationFn={async () =>
          pendingDelete ? deleteGateway(pendingDelete.id) : Promise.resolve()
        }
        isDanger
        isOpen={pendingDelete !== null}
        setIsOpen={(open) => {
          if (!open && !isDeleting) setPendingDelete(null);
        }}
      />
    </>
  );
}
