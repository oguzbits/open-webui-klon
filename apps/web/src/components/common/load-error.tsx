import { useTranslation } from 'react-i18next';

import { errorMessageKey } from '@/api/error-message';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/** The error state of an asynchronous view: what failed, and a way to try again. */
export function LoadError({
  error,
  onRetry,
  busy,
}: {
  error: unknown;
  onRetry: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Alert variant="destructive">
      <AlertTitle>{t('common.loadFailed')}</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>{t(errorMessageKey(error))}</p>
        <Button variant="outline" size="sm" disabled={busy} onClick={onRetry}>
          {t('common.retry')}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
