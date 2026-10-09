import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errorMessageKey } from '@/api/error-message';
import {
  getApiKeysListQueryKey,
  useApiKeysCreate,
  useApiKeysList,
  useApiKeysRevoke,
  useAuthConfig,
} from '@/api/generated/api';
import type { ApiKeyDto, CreatedApiKeyDto } from '@/api/generated/model';
import { LoadError } from '@/components/common/load-error';
import { PageLoading } from '@/components/common/page-loading';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDate } from '@/lib/format-date';

/** The choices of the "Laufzeit" select; the value is what the select holds, `days` what the server gets. */
const EXPIRY = {
  NEVER: { value: 'never', days: undefined },
  DAYS_30: { value: '30', days: 30 },
  DAYS_90: { value: '90', days: 90 },
  DAYS_365: { value: '365', days: 365 },
} as const;
type ExpiryChoice = (typeof EXPIRY)[keyof typeof EXPIRY];

function expiryFor(value: string): ExpiryChoice {
  return Object.values(EXPIRY).find((choice) => choice.value === value) ?? EXPIRY.NEVER;
}

const COPY_STATE = { IDLE: 'idle', DONE: 'done', FAILED: 'failed' } as const;
type CopyState = (typeof COPY_STATE)[keyof typeof COPY_STATE];

/** Mounted only while open, so every opening starts with empty fields. */
function CreateKeyDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (key: CreatedApiKeyDto) => void;
}) {
  const { t } = useTranslation();
  const nameId = useId();
  const expiryId = useId();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState<string>(EXPIRY.NEVER.value);
  const [formError, setFormError] = useState<string>();
  const create = useApiKeysCreate({
    mutation: {
      onSuccess: (result) => {
        void queryClient.invalidateQueries({ queryKey: getApiKeysListQueryKey() });
        // The generated type also lists error answers, which apiFetch throws instead of returning.
        if (result.status === 201) onCreated(result.data);
      },
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (create.isPending) return;
    if (name.trim() === '') {
      setFormError('account.keys.error.nameRequired');
      return;
    }
    setFormError(undefined);
    const { days } = expiryFor(expiry);
    create.mutate({ data: days === undefined ? { name } : { name, expiresInDays: days } });
  }

  const errorKey = formError ?? (create.isError ? errorMessageKey(create.error) : undefined);

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
            <DialogTitle>{t('account.keys.create')}</DialogTitle>
            <DialogDescription>{t('account.keys.createHint')}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={nameId}>{t('account.keys.name')}</FieldLabel>
              <Input
                id={nameId}
                value={name}
                maxLength={100}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={expiryId}>{t('account.keys.expiry')}</FieldLabel>
              <NativeSelect
                id={expiryId}
                value={expiry}
                onChange={(event) => {
                  setExpiry(event.target.value);
                }}
              >
                <NativeSelectOption value={EXPIRY.NEVER.value}>
                  {t('account.keys.expiryNever')}
                </NativeSelectOption>
                <NativeSelectOption value={EXPIRY.DAYS_30.value}>
                  {t('account.keys.expiryDays', { count: 30 })}
                </NativeSelectOption>
                <NativeSelectOption value={EXPIRY.DAYS_90.value}>
                  {t('account.keys.expiryDays', { count: 90 })}
                </NativeSelectOption>
                <NativeSelectOption value={EXPIRY.DAYS_365.value}>
                  {t('account.keys.expiryDays', { count: 365 })}
                </NativeSelectOption>
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
              {create.isPending ? t('account.keys.creating') : t('account.keys.createSubmit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Mounted only while a key is to be shown: closing drops the plaintext from memory and the page. */
function NewKeyDialog({ created, onClose }: { created: CreatedApiKeyDto; onClose: () => void }) {
  const { t } = useTranslation();
  const [copy, setCopy] = useState<CopyState>(COPY_STATE.IDLE);

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(created.key);
      setCopy(COPY_STATE.DONE);
    } catch {
      // No secure context or permission denied: the key stays selectable in the dialog.
      setCopy(COPY_STATE.FAILED);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('account.keys.shownTitle')}</DialogTitle>
          <DialogDescription>{t('account.keys.shownWarning')}</DialogDescription>
        </DialogHeader>
        <code className="bg-muted block rounded-md p-3 font-mono text-sm break-all select-all">
          {created.key}
        </code>
        <div className="flex items-center gap-3" aria-live="polite">
          <Button
            variant="outline"
            onClick={() => {
              void copyKey();
            }}
          >
            {t('account.keys.copy')}
          </Button>
          {copy === COPY_STATE.DONE && <span className="text-sm">{t('account.keys.copied')}</span>}
          {copy === COPY_STATE.FAILED && (
            <span className="text-destructive text-sm">{t('account.keys.copyFailed')}</span>
          )}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>{t('common.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KeyRow({
  apiKey,
  language,
  busy,
  onRevoke,
}: {
  apiKey: ApiKeyDto;
  language: string;
  busy: boolean;
  onRevoke: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <TableRow>
      <TableCell className="font-medium">{apiKey.name}</TableCell>
      <TableCell className="font-mono text-xs">{apiKey.prefix}</TableCell>
      <TableCell>{formatDate(apiKey.createdAt, language)}</TableCell>
      <TableCell>
        {apiKey.lastUsedAt === null
          ? t('account.keys.neverUsed')
          : formatDate(apiKey.lastUsedAt, language)}
      </TableCell>
      <TableCell>
        {apiKey.expiresAt === null
          ? t('account.keys.neverExpires')
          : formatDate(apiKey.expiresAt, language)}
      </TableCell>
      <TableCell className="text-right">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              aria-label={t('account.keys.revokeNamed', { name: apiKey.name })}
            >
              {t('account.keys.revoke')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t('account.keys.revokeTitle', { name: apiKey.name })}
              </AlertDialogTitle>
              <AlertDialogDescription>{t('account.keys.revokeBody')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  onRevoke(apiKey.id);
                }}
              >
                {t('account.keys.revoke')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </TableCell>
    </TableRow>
  );
}

export function ApiKeysSection() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const config = useAuthConfig();
  const enabled = config.data?.data.apiKeysEnabled === true;
  const keys = useApiKeysList({ query: { enabled } });
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedApiKeyDto>();
  const revoke = useApiKeysRevoke({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getApiKeysListQueryKey() }),
    },
  });

  if (config.isPending) return <PageLoading />;
  if (config.isError) {
    return (
      <LoadError
        error={config.error}
        busy={config.isFetching}
        onRetry={() => {
          void config.refetch();
        }}
      />
    );
  }
  if (!enabled) {
    return <p className="text-muted-foreground text-sm">{t('account.keys.off')}</p>;
  }

  let list: ReactNode;
  if (keys.isPending) {
    list = <PageLoading />;
  } else if (keys.isError || keys.data.status !== 200) {
    // Only 200 is ever returned here (apiFetch throws the rest); anything else is shown as a failed load.
    list = (
      <LoadError
        error={keys.error}
        busy={keys.isFetching}
        onRetry={() => {
          void keys.refetch();
        }}
      />
    );
  } else if (keys.data.data.length === 0) {
    list = <p className="text-muted-foreground text-sm">{t('account.keys.empty')}</p>;
  } else {
    list = (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('account.keys.name')}</TableHead>
            <TableHead>{t('account.keys.prefix')}</TableHead>
            <TableHead>{t('account.keys.createdAt')}</TableHead>
            <TableHead>{t('account.keys.lastUsed')}</TableHead>
            <TableHead>{t('account.keys.expiresAt')}</TableHead>
            <TableHead>
              <span className="sr-only">{t('account.keys.actions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {keys.data.data.map((apiKey) => (
            <KeyRow
              key={apiKey.id}
              apiKey={apiKey}
              language={i18n.language}
              busy={revoke.isPending}
              onRevoke={(id) => {
                revoke.mutate({ id });
              }}
            />
          ))}
        </TableBody>
      </Table>
    );
  }

  return (
    <div className="space-y-4">
      {list}
      {revoke.isError && (
        <Alert variant="destructive">
          <AlertDescription>{t(errorMessageKey(revoke.error))}</AlertDescription>
        </Alert>
      )}
      <Button
        onClick={() => {
          setCreating(true);
        }}
      >
        {t('account.keys.create')}
      </Button>
      {creating && (
        <CreateKeyDialog
          onClose={() => {
            setCreating(false);
          }}
          onCreated={(key) => {
            setCreating(false);
            setCreated(key);
          }}
        />
      )}
      {created !== undefined && (
        <NewKeyDialog
          created={created}
          onClose={() => {
            setCreated(undefined);
          }}
        />
      )}
    </div>
  );
}
