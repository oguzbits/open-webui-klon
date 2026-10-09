import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errorMessageKey } from '@/api/error-message';
import { useUsersSetPassword } from '@/api/generated/api';
import type { UserDto } from '@/api/generated/model';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/features/auth/password-policy';

/** Mounted only while open for one account. */
export function SetPasswordDialog({ user, onClose }: { user: UserDto; onClose: () => void }) {
  const { t } = useTranslation();
  const passwordId = useId();
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string>();
  const setUserPassword = useUsersSetPassword({ mutation: { onSuccess: onClose } });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (setUserPassword.isPending) return;
    if (password === '') {
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
    setUserPassword.mutate({ id: user.id, data: { password } });
  }

  const errorKey =
    formError ??
    (setUserPassword.isError
      ? errorMessageKey(setUserPassword.error, { 400: 'auth.error.invalid' })
      : undefined);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t('admin.users.password.title', { name: user.name })}</DialogTitle>
            <DialogDescription>
              {t('admin.users.password.description', { name: user.name })}
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={passwordId}>{t('admin.users.password.label')}</FieldLabel>
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
          {errorKey !== undefined && (
            <Alert variant="destructive">
              <AlertDescription>{t(errorKey)}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={setUserPassword.isPending}>
              {setUserPassword.isPending
                ? t('admin.users.password.submitting')
                : t('admin.users.password.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
