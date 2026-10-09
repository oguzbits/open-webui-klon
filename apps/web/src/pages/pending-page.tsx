import { useTranslation } from 'react-i18next';

import { errorMessageKey } from '@/api/error-message';
import { useAuthMe } from '@/api/generated/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { useCurrentUser } from '@/features/auth/session';
import { useSignOut } from '@/features/auth/use-sign-out';

export function PendingPage() {
  const { t } = useTranslation();
  const user = useCurrentUser();
  // Same freshness as the session gate, so opening the page does not fetch `me` a second time.
  const me = useAuthMe({ query: { staleTime: 60_000 } });
  const signOut = useSignOut();

  return (
    <main className="grid min-h-svh place-items-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <h1 className="text-xl font-semibold">{t('pending.title')}</h1>
          <CardDescription>{t('pending.body', { name: user.name })}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {(me.isError || signOut.isError) && (
            <Alert variant="destructive">
              <AlertDescription>{t(errorMessageKey(me.error ?? signOut.error))}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={me.isFetching}
              onClick={() => {
                void me.refetch();
              }}
            >
              {me.isFetching ? t('pending.checking') : t('pending.check')}
            </Button>
            <Button
              variant="outline"
              disabled={signOut.isPending}
              onClick={() => {
                signOut.mutate();
              }}
            >
              {signOut.isPending ? t('userMenu.signingOut') : t('userMenu.signOut')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
