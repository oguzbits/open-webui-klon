import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errorMessageKey } from '@/api/error-message';
import { getUsersListQueryKey, useUsersCreate } from '@/api/generated/api';
import { UserDtoRole } from '@/api/generated/model';
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/features/auth/password-policy';

import { parseRole, ROLE_LABEL } from './roles';

/** Mounted only while open, so every opening starts with empty fields. */
export function CreateUserDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const nameId = useId();
  const emailId = useId();
  const passwordId = useId();
  const roleId = useId();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserDtoRole>(UserDtoRole.user);
  const [formError, setFormError] = useState<string>();
  const create = useUsersCreate({
    mutation: {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: getUsersListQueryKey() });
        onClose();
      },
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (create.isPending) return;
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
    create.mutate({ data: { name, email, password, role } });
  }

  const errorKey =
    formError ??
    (create.isError
      ? errorMessageKey(create.error, { 400: 'auth.error.invalid', 409: 'auth.error.taken' })
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
            <DialogTitle>{t('admin.users.create')}</DialogTitle>
            <DialogDescription>{t('admin.users.createHint')}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={nameId}>{t('admin.users.fields.name')}</FieldLabel>
              <Input
                id={nameId}
                autoComplete="off"
                maxLength={100}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={emailId}>{t('admin.users.fields.email')}</FieldLabel>
              <Input
                id={emailId}
                type="email"
                autoComplete="off"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={passwordId}>{t('admin.users.fields.password')}</FieldLabel>
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
            <Field>
              <FieldLabel htmlFor={roleId}>{t('admin.users.fields.role')}</FieldLabel>
              <NativeSelect
                id={roleId}
                value={role}
                onChange={(event) => {
                  setRole(parseRole(event.target.value) ?? UserDtoRole.user);
                }}
              >
                {Object.values(UserDtoRole).map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {t(ROLE_LABEL[value])}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          </FieldGroup>
          {errorKey !== undefined && (
            <Alert variant="destructive">
              <AlertDescription>{t(errorKey)}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? t('admin.users.creating') : t('admin.users.createSubmit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
