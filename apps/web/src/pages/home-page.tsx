import { useTranslation } from 'react-i18next';

import { ApiStatus } from '@/features/health/api-status';

export function HomePage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">{t('home.title')}</h1>
      <p className="text-muted-foreground">{t('home.intro')}</p>
      <ApiStatus />
    </div>
  );
}
