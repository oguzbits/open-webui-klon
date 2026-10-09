import { useTranslation } from 'react-i18next';

import { UsersTable } from '@/features/admin/users-table';

export function AdminUsersPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t('admin.title')}</h1>
        <p className="text-muted-foreground text-sm">{t('admin.users.description')}</p>
      </div>
      <UsersTable />
    </div>
  );
}
