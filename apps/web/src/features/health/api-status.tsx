import { useTranslation } from 'react-i18next';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { useApiHealth } from './use-api-health';

export function ApiStatus() {
  const { t } = useTranslation();
  const health = useApiHealth();

  if (health.isPending) {
    return (
      <div role="status">
        <Skeleton className="h-16 w-full" />
        <span className="sr-only">{t('status.checking')}</span>
      </div>
    );
  }

  if (health.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{t('status.title')}</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{t('status.error')}</p>
          <Button
            variant="outline"
            size="sm"
            disabled={health.isFetching}
            onClick={() => {
              void health.refetch();
            }}
          >
            {t('status.retry')}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert>
      <AlertTitle>{t('status.title')}</AlertTitle>
      <AlertDescription>{t('status.ok')}</AlertDescription>
    </Alert>
  );
}
