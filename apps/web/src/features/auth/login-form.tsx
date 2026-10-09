import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errorMessageKey } from '@/api/error-message';
import { useAuthLogin } from '@/api/generated/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import { storeSession } from './store-session';

export function LoginForm() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const emailId = useId();
  const passwordId = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string>();
  const login = useAuthLogin({
    mutation: {
      onSuccess: (result) => {
        // The generated type also lists the 401 answer, which apiFetch throws instead of returning.
        if (result.status === 200) storeSession(queryClient, result.data);
      },
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (login.isPending) return;
    if (email.trim() === '' || password === '') {
      setFormError('auth.error.required');
      return;
    }
    setFormError(undefined);
    login.mutate({ data: { email, password } });
  }

  const errorKey =
    formError ??
    (login.isError
      ? errorMessageKey(login.error, { 400: 'auth.error.invalid', 401: 'auth.error.credentials' })
      : undefined);

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={emailId}>{t('auth.login.email')}</FieldLabel>
          <Input
            id={emailId}
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={passwordId}>{t('auth.login.password')}</FieldLabel>
          <Input
            id={passwordId}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
        </Field>
      </FieldGroup>
      {errorKey !== undefined && (
        <Alert variant="destructive">
          <AlertDescription>{t(errorKey)}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" className="w-full" disabled={login.isPending}>
        {login.isPending ? t('auth.login.submitting') : t('auth.login.submit')}
      </Button>
    </form>
  );
}
