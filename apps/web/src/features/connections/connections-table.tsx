import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errorMessageKey } from '@/api/error-message';
import {
  getModelsListQueryKey,
  getProviderConnectionsListQueryKey,
  useProviderConnectionsList,
  useProviderConnectionsRemove,
  useProviderConnectionsUpdate,
} from '@/api/generated/api';
import type { ModelListDto, ProviderConnectionDto } from '@/api/generated/model';
import { LoadError } from '@/components/common/load-error';
import { PageLoading } from '@/components/common/page-loading';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useModels } from '@/features/models/use-models';

import { ConnectionDialog } from './connection-dialog';
import {
  CONNECTION_STATUS,
  type ConnectionStatus,
  connectionStatus,
  unreachableReason,
  visibleModelCount,
} from './connection-status';
import { DeleteConnectionDialog } from './delete-connection-dialog';
import { reasonKey } from './provider-reason';

const STATUS_VARIANT = {
  [CONNECTION_STATUS.ACTIVE]: 'secondary',
  [CONNECTION_STATUS.DISABLED]: 'outline',
  [CONNECTION_STATUS.UNREACHABLE]: 'destructive',
  [CONNECTION_STATUS.UNKNOWN]: 'outline',
} as const satisfies Record<ConnectionStatus, 'secondary' | 'outline' | 'destructive'>;

function ConnectionRow({
  connection,
  health,
  busy,
  onEdit,
  onToggle,
  onRemove,
}: {
  connection: ProviderConnectionDto;
  health: ModelListDto | undefined;
  busy: boolean;
  onEdit: (id: string) => void;
  onToggle: (connection: ProviderConnectionDto) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation();
  const status = connectionStatus(connection, health);
  const reason = unreachableReason(connection, health);
  const count = visibleModelCount(connection, health);
  return (
    <TableRow>
      <TableCell className="font-medium">{connection.name}</TableCell>
      <TableCell>{t(`connections.type.${connection.type}`)}</TableCell>
      <TableCell className="max-w-64 truncate" title={connection.baseUrl}>
        {connection.baseUrl}
      </TableCell>
      <TableCell>
        <div className="space-y-1">
          <Badge variant={STATUS_VARIANT[status]}>{t(`connections.status.${status}`)}</Badge>
          {reason !== undefined && (
            <p className="text-muted-foreground text-xs">{t(reasonKey(reason))}</p>
          )}
        </div>
      </TableCell>
      <TableCell>{count ?? t('connections.noModels')}</TableCell>
      <TableCell>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            aria-label={t('connections.editNamed', { name: connection.name })}
            onClick={() => {
              onEdit(connection.id);
            }}
          >
            {t('connections.edit')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            aria-label={t(
              connection.enabled ? 'connections.disableNamed' : 'connections.enableNamed',
              { name: connection.name }
            )}
            onClick={() => {
              onToggle(connection);
            }}
          >
            {t(connection.enabled ? 'connections.disable' : 'connections.enable')}
          </Button>
          <DeleteConnectionDialog
            connection={connection}
            busy={busy}
            onConfirm={() => {
              onRemove(connection.id);
            }}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}

export function ConnectionsTable() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const connections = useProviderConnectionsList();
  const models = useModels();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  // Looked up in the current list: an edit of a provider that was deleted meanwhile simply closes.
  const editing =
    connections.data?.status === 200
      ? connections.data.data.find((connection) => connection.id === editingId)
      : undefined;
  // A change to a connection changes what users see, so the model list is fetched again as well.
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: getProviderConnectionsListQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getModelsListQueryKey() }),
    ]);
  const update = useProviderConnectionsUpdate({ mutation: { onSuccess: refresh } });
  const remove = useProviderConnectionsRemove({ mutation: { onSuccess: refresh } });
  const busy = update.isPending || remove.isPending;
  const health = models.isSuccess ? models.data : undefined;

  function toggle(connection: ProviderConnectionDto) {
    remove.reset();
    update.mutate({ id: connection.id, data: { enabled: !connection.enabled } });
  }

  function removeConnection(id: string) {
    update.reset();
    remove.mutate({ id });
  }

  const failure: unknown = update.isError ? update.error : remove.error;
  const failed = update.isError || remove.isError;

  let body: ReactNode;
  if (connections.isPending) {
    body = <PageLoading />;
  } else if (connections.isError || connections.data.status !== 200) {
    // Only 200 is ever returned here (apiFetch throws the rest); anything else is shown as a failed load.
    body = (
      <LoadError
        error={connections.error}
        busy={connections.isFetching}
        onRetry={() => {
          void connections.refetch();
        }}
      />
    );
  } else if (connections.data.data.length === 0) {
    body = <p className="text-muted-foreground text-sm">{t('connections.empty')}</p>;
  } else {
    body = (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('connections.columns.name')}</TableHead>
            <TableHead>{t('connections.columns.type')}</TableHead>
            <TableHead>{t('connections.columns.address')}</TableHead>
            <TableHead>{t('connections.columns.status')}</TableHead>
            <TableHead>{t('connections.columns.models')}</TableHead>
            <TableHead>
              <span className="sr-only">{t('connections.columns.actions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {connections.data.data.map((connection) => (
            <ConnectionRow
              key={connection.id}
              connection={connection}
              health={health}
              busy={busy}
              onEdit={setEditingId}
              onToggle={toggle}
              onRemove={removeConnection}
            />
          ))}
        </TableBody>
      </Table>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <Button
          onClick={() => {
            setCreating(true);
          }}
        >
          {t('connections.create')}
        </Button>
      </div>
      {failed && (
        <Alert variant="destructive">
          <AlertDescription>{t(errorMessageKey(failure))}</AlertDescription>
        </Alert>
      )}
      {models.isError && (
        <Alert>
          <AlertDescription className="space-y-3">
            <p>{t('connections.healthUnknown')}</p>
            <Button
              variant="outline"
              size="sm"
              disabled={models.isFetching}
              onClick={() => {
                void models.refetch();
              }}
            >
              {t('common.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {body}
      {creating && (
        <ConnectionDialog
          onClose={() => {
            setCreating(false);
          }}
        />
      )}
      {editing !== undefined && (
        <ConnectionDialog
          connection={editing}
          onClose={() => {
            setEditingId(undefined);
          }}
        />
      )}
    </div>
  );
}
