import { useTranslation } from 'react-i18next';

import { ModelsList } from '@/features/models/models-list';

export function ModelsPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t('models.title')}</h1>
        <p className="text-muted-foreground text-sm">{t('models.description')}</p>
      </div>
      <ModelsList />
    </div>
  );
}
