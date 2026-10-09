import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errorMessageKey } from '@/api/error-message';
import {
  getUsersListQueryKey,
  useUsersList,
  useUsersRemove,
  useUsersUpdate,
} from '@/api/generated/api';
import { type UpdateUserDto, type UserDto, UserDtoRole } from '@/api/generated/model';
import { LoadError } from '@/components/common/load-error';
import { PageLoading } from '@/components/common/page-loading';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCurrentUser } from '@/features/auth/session';
import { formatDate } from '@/lib/format-date';

import { CreateUserDialog } from './create-user-dialog';
import { DeleteUserDialog } from './delete-user-dialog';
import { parseRole, ROLE_LABEL } from './roles';
import { SetPasswordDialog } from './set-password-dialog';

const USER_STATUS = { ACTIVE: 'active', PENDING: 'pending', DISABLED: 'disabled' } as const;
type UserStatus = (typeof USER_STATUS)[keyof typeof USER_STATUS];

function statusOf(user: UserDto): UserStatus {
  if (user.disabled) return USER_STATUS.DISABLED;
  return user.role === UserDtoRole.pending ? USER_STATUS.PENDING : USER_STATUS.ACTIVE;
}

const STATUS_VARIANT = {
  [USER_STATUS.ACTIVE]: 'secondary',
  [USER_STATUS.PENDING]: 'outline',
  [USER_STATUS.DISABLED]: 'destructive',
} as const satisfies Record<UserStatus, 'secondary' | 'outline' | 'destructive'>;

function UserRow({
  user,
  isSelf,
  busy,
  language,
  onChange,
  onRemove,
  onSetPassword,
}: {
  user: UserDto;
  isSelf: boolean;
  busy: boolean;
  language: string;
  onChange: (id: string, data: UpdateUserDto) => void;
  onRemove: (id: string) => void;
  onSetPassword: (user: UserDto) => void;
}) {
  const { t } = useTranslation();
  const status = statusOf(user);
  return (
    <TableRow>
      <TableCell className="font-medium">{user.name}</TableCell>
      <TableCell>{user.email}</TableCell>
      <TableCell>
        {isSelf ? (
          t(ROLE_LABEL[user.role])
        ) : (
          <NativeSelect
            aria-label={t('admin.users.roleOf', { name: user.name })}
            value={user.role}
            disabled={busy}
            onChange={(event) => {
              const role = parseRole(event.target.value);
              if (role !== undefined) onChange(user.id, { role });
            }}
          >
            {Object.values(UserDtoRole).map((value) => (
              <NativeSelectOption key={value} value={value}>
                {t(ROLE_LABEL[value])}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </TableCell>
      <TableCell>
        <Badge variant={STATUS_VARIANT[status]}>{t(`admin.users.status.${status}`)}</Badge>
      </TableCell>
      <TableCell>{formatDate(user.createdAt, language)}</TableCell>
      <TableCell>
        {isSelf ? (
          <span className="text-muted-foreground text-sm">{t('admin.users.you')}</span>
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            {user.role === UserDtoRole.pending && !user.disabled && (
              <Button
                size="sm"
                disabled={busy}
                aria-label={t('admin.users.approveNamed', { name: user.name })}
                onClick={() => {
                  onChange(user.id, { role: UserDtoRole.user });
                }}
              >
                {t('admin.users.approve')}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              aria-label={t(
                user.disabled ? 'admin.users.enableNamed' : 'admin.users.disableNamed',
                {
                  name: user.name,
                }
              )}
              onClick={() => {
                onChange(user.id, { disabled: !user.disabled });
              }}
            >
              {t(user.disabled ? 'admin.users.enable' : 'admin.users.disable')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              aria-label={t('admin.users.password.named', { name: user.name })}
              onClick={() => {
                onSetPassword(user);
              }}
            >
              {t('admin.users.password.action')}
            </Button>
            <DeleteUserDialog
              user={user}
              busy={busy}
              onConfirm={() => {
                onRemove(user.id);
              }}
            />
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

export function UsersTable() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const self = useCurrentUser();
  const users = useUsersList();
  const [creating, setCreating] = useState(false);
  const [passwordFor, setPasswordFor] = useState<UserDto>();
  const refresh = () => queryClient.invalidateQueries({ queryKey: getUsersListQueryKey() });
  const update = useUsersUpdate({ mutation: { onSuccess: refresh } });
  const remove = useUsersRemove({ mutation: { onSuccess: refresh } });
  const busy = update.isPending || remove.isPending;

  function change(id: string, data: UpdateUserDto) {
    remove.reset();
    update.mutate({ id, data });
  }

  function removeUser(id: string) {
    update.reset();
    remove.mutate({ id });
  }

  // 409 on a change or a delete is the "at least one active admin" rule of the server.
  const failure: unknown = update.isError ? update.error : remove.error;
  const failed = update.isError || remove.isError;

  let body: ReactNode;
  if (users.isPending) {
    body = <PageLoading />;
  } else if (users.isError || users.data.status !== 200) {
    // Only 200 is ever returned here (apiFetch throws the rest); anything else is shown as a failed load.
    body = (
      <LoadError
        error={users.error}
        busy={users.isFetching}
        onRetry={() => {
          void users.refetch();
        }}
      />
    );
  } else {
    // The list is never empty: the signed-in admin is part of it, so there is no empty state.
    body = (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('admin.users.columns.name')}</TableHead>
            <TableHead>{t('admin.users.columns.email')}</TableHead>
            <TableHead>{t('admin.users.columns.role')}</TableHead>
            <TableHead>{t('admin.users.columns.status')}</TableHead>
            <TableHead>{t('admin.users.columns.createdAt')}</TableHead>
            <TableHead>
              <span className="sr-only">{t('admin.users.columns.actions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.data.data.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              isSelf={user.id === self.id}
              busy={busy}
              language={i18n.language}
              onChange={change}
              onRemove={removeUser}
              onSetPassword={setPasswordFor}
            />
          ))}
        </TableBody>
      </Table>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <Button
          onClick={() => {
            setCreating(true);
          }}
        >
          {t('admin.users.create')}
        </Button>
      </div>
      {failed && (
        <Alert variant="destructive">
          <AlertDescription>
            {t(errorMessageKey(failure, { 409: 'admin.users.error.lastAdmin' }))}
          </AlertDescription>
        </Alert>
      )}
      {body}
      {creating && (
        <CreateUserDialog
          onClose={() => {
            setCreating(false);
          }}
        />
      )}
      {passwordFor !== undefined && (
        <SetPasswordDialog
          user={passwordFor}
          onClose={() => {
            setPasswordFor(undefined);
          }}
        />
      )}
    </div>
  );
}
