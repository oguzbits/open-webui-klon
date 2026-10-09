import { useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { errorMessageKey } from '@/api/error-message';
import {
  getModelsListQueryKey,
  getProviderConnectionsListQueryKey,
  getProviderConnectionsModelsQueryKey,
  useProviderConnectionsModels,
  useProviderConnectionsUpdate,
} from '@/api/generated/api';
import type { AdminModelDto, ProviderConnectionDto } from '@/api/generated/model';
import { LoadError } from '@/components/common/load-error';
import { PageLoading } from '@/components/common/page-loading';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function ConnectionModelsDialog({
  connection,
  onClose,
}: {
  connection: ProviderConnectionDto;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const models = useProviderConnectionsModels(connection.id);
  // The mutation stays pending until the lists are fetched again, so the buttons stay locked until the
  // stored list the next click is derived from is current.
  const update = useProviderConnectionsUpdate({
    mutation: {
      onSuccess: () =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: getProviderConnectionsListQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getModelsListQueryKey() }),
          queryClient.invalidateQueries({
            queryKey: getProviderConnectionsModelsQueryKey(connection.id),
          }),
        ]),
    },
  });

  /**
   * The server replaces the stored list with the one we send, so the new list starts from the stored one
   * (not from what the provider reports now): an id the provider no longer reports stays hidden.
   */
  function toggle(model: AdminModelDto) {
    const hiddenModelIds = model.hidden
      ? connection.hiddenModelIds.filter((id) => id !== model.rawModelId)
      : [...new Set([...connection.hiddenModelIds, model.rawModelId])];
    update.mutate({ id: connection.id, data: { hiddenModelIds } });
  }

  let body: ReactNode;
  if (models.isPending) {
    body = <PageLoading />;
  } else if (models.isError || models.data.status !== 200) {
    // Only 200 is ever returned here (apiFetch throws the rest); anything else is shown as a failed load.
    body = (
      <LoadError
        error={models.error}
        busy={models.isFetching}
        onRetry={() => {
          void models.refetch();
        }}
      />
    );
  } else if (models.data.data.models.length === 0) {
    body = <p className="text-muted-foreground text-sm">{t('connections.modelsDialog.empty')}</p>;
  } else {
    body = (
      <ul className="max-h-[60vh] divide-y overflow-y-auto">
        {models.data.data.models.map((model) => (
          <li key={model.rawModelId} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="truncate font-medium">{model.name}</p>
              {model.name !== model.rawModelId && (
                <p className="text-muted-foreground truncate text-xs">{model.rawModelId}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {model.hidden && (
                <Badge variant="outline">{t('connections.modelsDialog.hidden')}</Badge>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={update.isPending}
                aria-label={t(
                  model.hidden
                    ? 'connections.modelsDialog.showNamed'
                    : 'connections.modelsDialog.hideNamed',
                  { model: model.name }
                )}
                onClick={() => {
                  toggle(model);
                }}
              >
                {t(
                  model.hidden ? 'connections.modelsDialog.show' : 'connections.modelsDialog.hide'
                )}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t('connections.modelsDialog.title', { name: connection.name })}
          </DialogTitle>
          <DialogDescription>{t('connections.modelsDialog.description')}</DialogDescription>
        </DialogHeader>
        {body}
        {update.isError && (
          <Alert variant="destructive">
            <AlertDescription>{t(errorMessageKey(update.error))}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
