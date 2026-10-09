import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errorMessageKey } from '@/api/error-message';
import { useAuthSignup } from '@/api/generated/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './password-policy';
import { storeSession } from './store-session';

export function SignupForm() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const nameId = useId();
  const emailId = useId();
  const passwordId = useId();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string>();
  const signup = useAuthSignup({
    mutation: {
      onSuccess: (result) => {
        storeSession(queryClient, result.data);
      },
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (signup.isPending) return;
    if (name.trim() === '' || email.trim() === '' || password === '') {
      setFormError('auth.error.required');
      return;
    }
    if (password.length < PASSWORD_MIN_LENGTH) {
      setFormError('auth.error.passwordShort');
      return;
    }
    if (password.length > PASSWORD_MAX_LENGTH) {
      setFormError('auth.error.passwordLong');
      return;
    }
    setFormError(undefined);
    signup.mutate({ data: { email, name, password } });
  }

  const errorKey =
    formError ??
    (signup.isError
      ? errorMessageKey(signup.error, {
          400: 'auth.error.invalid',
          403: 'auth.error.closed',
          409: 'auth.error.taken',
        })
      : undefined);

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={nameId}>{t('auth.signup.name')}</FieldLabel>
          <Input
            id={nameId}
            autoComplete="name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </Field>
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
            autoComplete="new-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
          <FieldDescription>{t('auth.signup.passwordHint')}</FieldDescription>
        </Field>
      </FieldGroup>
      {errorKey !== undefined && (
        <Alert variant="destructive">
          <AlertDescription>{t(errorKey)}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" className="w-full" disabled={signup.isPending}>
        {signup.isPending ? t('auth.signup.submitting') : t('auth.signup.submit')}
      </Button>
    </form>
  );
}
