import { useTranslation } from 'react-i18next';

import { Skeleton } from '@/components/ui/skeleton';

export function PageLoading() {
  const { t } = useTranslation();
  return (
    <div role="status" className="w-full max-w-md">
      <Skeleton className="h-24 w-full" />
      <span className="sr-only">{t('common.loading')}</span>
    </div>
  );
}
