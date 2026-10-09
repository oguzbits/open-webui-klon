import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuthConfig } from '@/api/generated/api';
import { LoadError } from '@/components/common/load-error';
import { PageLoading } from '@/components/common/page-loading';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from '@/components/ui/card';
import { LoginForm } from '@/features/auth/login-form';
import { SignupForm } from '@/features/auth/signup-form';

const AUTH_MODE = { LOGIN: 'login', SIGNUP: 'signup' } as const;
type AuthMode = (typeof AUTH_MODE)[keyof typeof AUTH_MODE];

export function LoginPage() {
  const { t } = useTranslation();
  const config = useAuthConfig();
  const [chosen, setChosen] = useState<AuthMode>();

  let content: ReactNode;
  if (config.isPending) {
    content = <PageLoading />;
  } else if (config.isError) {
    content = (
      <LoadError
        error={config.error}
        busy={config.isFetching}
        onRetry={() => {
          void config.refetch();
        }}
      />
    );
  } else {
    const { signupEnabled, onboarding } = config.data.data;
    const mode = chosen ?? (onboarding ? AUTH_MODE.SIGNUP : AUTH_MODE.LOGIN);
    const signingUp = mode === AUTH_MODE.SIGNUP;
    let description = t(signingUp ? 'auth.signup.description' : 'auth.login.description');
    if (signingUp && onboarding) description = t('auth.signup.onboarding');
    content = (
      <Card>
        <CardHeader>
          <h1 className="text-xl font-semibold">
            {t(signingUp ? 'auth.signup.title' : 'auth.login.title')}
          </h1>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{signingUp ? <SignupForm /> : <LoginForm />}</CardContent>
        {signupEnabled && !onboarding && (
          <CardFooter>
            <Button
              variant="link"
              className="px-0"
              onClick={() => {
                setChosen(signingUp ? AUTH_MODE.LOGIN : AUTH_MODE.SIGNUP);
              }}
            >
              {t(signingUp ? 'auth.switch.toLogin' : 'auth.switch.toSignup')}
            </Button>
          </CardFooter>
        )}
      </Card>
    );
  }

  return (
    <main className="grid min-h-svh place-items-center p-4">
      <div className="w-full max-w-sm">{content}</div>
    </main>
  );
}
