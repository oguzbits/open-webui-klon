import { useTranslation } from 'react-i18next';

import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { ApiKeysSection } from '@/features/account/api-keys-section';
import { PasswordForm } from '@/features/account/password-form';
import { useCurrentUser } from '@/features/auth/session';

export function AccountPage() {
  const { t } = useTranslation();
  const user = useCurrentUser();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">{t('account.title')}</h1>
      <Card>
        <CardHeader>
          <h2 className="font-semibold">{t('account.profile.title')}</h2>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t('account.profile.name')}</dt>
            <dd>{user.name}</dd>
            <dt className="text-muted-foreground">{t('account.profile.email')}</dt>
            <dd>{user.email}</dd>
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <h2 className="font-semibold">{t('account.password.title')}</h2>
          <CardDescription>{t('account.password.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <PasswordForm />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <h2 className="font-semibold">{t('account.keys.title')}</h2>
          <CardDescription>{t('account.keys.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ApiKeysSection />
        </CardContent>
      </Card>
    </div>
  );
}
