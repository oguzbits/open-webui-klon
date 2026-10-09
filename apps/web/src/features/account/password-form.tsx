import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errorMessageKey } from '@/api/error-message';
import { useAuthChangePassword } from '@/api/generated/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/features/auth/password-policy';

export function PasswordForm() {
  const { t } = useTranslation();
  const currentId = useId();
  const nextId = useId();
  const repeatId = useId();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [formError, setFormError] = useState<string>();
  const change = useAuthChangePassword({
    mutation: {
      onSuccess: () => {
        setCurrent('');
        setNext('');
        setRepeat('');
      },
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (change.isPending) return;
    change.reset();
    if (current === '' || next === '' || repeat === '') {
      setFormError('auth.error.required');
      return;
    }
    if (next.length < PASSWORD_MIN_LENGTH) {
      setFormError('auth.error.passwordShort');
      return;
    }
    if (next.length > PASSWORD_MAX_LENGTH) {
      setFormError('auth.error.passwordLong');
      return;
    }
    if (next !== repeat) {
      setFormError('account.password.error.mismatch');
      return;
    }
    setFormError(undefined);
    change.mutate({ data: { currentPassword: current, newPassword: next } });
  }

  // A wrong current password is a 400 on purpose (a 401 would end the session in the fetcher), so 400 covers both.
  const errorKey =
    formError ??
    (change.isError
      ? errorMessageKey(change.error, { 400: 'account.password.error.rejected' })
      : undefined);

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={currentId}>{t('account.password.current')}</FieldLabel>
          <Input
            id={currentId}
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(event) => {
              setCurrent(event.target.value);
            }}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={nextId}>{t('account.password.next')}</FieldLabel>
          <Input
            id={nextId}
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(event) => {
              setNext(event.target.value);
            }}
          />
          <FieldDescription>{t('auth.signup.passwordHint')}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={repeatId}>{t('account.password.repeat')}</FieldLabel>
          <Input
            id={repeatId}
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(event) => {
              setRepeat(event.target.value);
            }}
          />
        </Field>
      </FieldGroup>
      {errorKey !== undefined && (
        <Alert variant="destructive">
          <AlertDescription>{t(errorKey)}</AlertDescription>
        </Alert>
      )}
      {change.isSuccess && formError === undefined && (
        <Alert>
          <AlertDescription>{t('account.password.done')}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={change.isPending}>
        {change.isPending ? t('account.password.submitting') : t('account.password.submit')}
      </Button>
    </form>
  );
}
