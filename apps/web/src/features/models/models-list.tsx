import { useTranslation } from 'react-i18next';

import { LoadError } from '@/components/common/load-error';
import { PageLoading } from '@/components/common/page-loading';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { reasonKey } from '@/features/connections/provider-reason';

import { useModels } from './use-models';

export function ModelsList() {
  const { t } = useTranslation();
  const models = useModels();

  if (models.isPending) return <PageLoading />;
  if (models.isError) {
    return (
      <LoadError
        error={models.error}
        busy={models.isFetching}
        onRetry={() => {
          void models.refetch();
        }}
      />
    );
  }

  const { models: available, unavailableConnections } = models.data;
  return (
    <div className="space-y-4">
      <div>
        <Button
          variant="outline"
          size="sm"
          disabled={models.isFetching}
          onClick={() => {
            void models.refetch();
          }}
        >
          {models.isFetching ? t('models.refreshing') : t('models.refresh')}
        </Button>
      </div>
      {unavailableConnections.length > 0 && (
        <Alert>
          <AlertTitle>{t('models.unavailable.title')}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-5">
              {unavailableConnections.map((connection) => (
                <li key={connection.id}>
                  {t('models.unavailable.item', {
                    name: connection.name,
                    reason: t(reasonKey(connection.reason)),
                  })}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {available.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('models.empty')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('models.columns.name')}</TableHead>
              <TableHead>{t('models.columns.provider')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {available.map((model) => (
              <TableRow key={model.id}>
                <TableCell className="font-medium">{model.name}</TableCell>
                <TableCell>{model.providerName}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
