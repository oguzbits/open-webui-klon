import { useTranslation } from 'react-i18next';

import { ConnectionsTable } from '@/features/connections/connections-table';

export function AdminConnectionsPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t('connections.title')}</h1>
        <p className="text-muted-foreground text-sm">{t('connections.description')}</p>
      </div>
      <ConnectionsTable />
    </div>
  );
}
