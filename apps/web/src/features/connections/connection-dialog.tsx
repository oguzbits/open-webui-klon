import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errorMessageKey } from '@/api/error-message';
import {
  getModelsListQueryKey,
  getProviderConnectionsListQueryKey,
  getProviderConnectionsModelsQueryKey,
  useProviderConnectionsCreate,
  useProviderConnectionsTest,
  useProviderConnectionsUpdate,
} from '@/api/generated/api';
import { CreateProviderConnectionDtoType, type ProviderConnectionDto } from '@/api/generated/model';
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

import { buildPatch, KEY_MODE, type KeyMode } from './connection-form';
import { testFailureKey } from './provider-reason';

/** Narrows the string of a select to a kind without a cast. */
function parseType(value: string): CreateProviderConnectionDtoType | undefined {
  return Object.values(CreateProviderConnectionDtoType).find((known) => known === value);
}

/**
 * Creates a connection, or edits `connection`. Mounted only while open, so every opening starts from the stored
 * values and an empty key field; the key typed here lives in this component's state and nowhere else.
 */
export function ConnectionDialog({
  connection,
  onClose,
}: {
  connection?: ProviderConnectionDto;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const nameId = useId();
  const typeId = useId();
  const addressId = useId();
  const keyId = useId();
  const hasStoredKey = connection?.hasApiKey === true;
  const [name, setName] = useState(connection?.name ?? '');
  const [type, setType] = useState<CreateProviderConnectionDtoType>(
    CreateProviderConnectionDtoType.ollama
  );
  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl ?? '');
  const [keyMode, setKeyMode] = useState<KeyMode>(hasStoredKey ? KEY_MODE.KEEP : KEY_MODE.REPLACE);
  const [newKey, setNewKey] = useState('');
  const [formError, setFormError] = useState<string>();

  // What users see depends on the connection, so lists are fetched again before the dialog closes.
  async function refreshAndClose() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getProviderConnectionsListQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getModelsListQueryKey() }),
      ...(connection === undefined
        ? []
        : [
            queryClient.invalidateQueries({
              queryKey: getProviderConnectionsModelsQueryKey(connection.id),
            }),
          ]),
    ]);
    onClose();
  }
  const create = useProviderConnectionsCreate({ mutation: { onSuccess: refreshAndClose } });
  const update = useProviderConnectionsUpdate({ mutation: { onSuccess: refreshAndClose } });
  const test = useProviderConnectionsTest();

  const pending = create.isPending || update.isPending;
  const patch =
    connection === undefined ? {} : buildPatch(connection, { name, baseUrl, keyMode, newKey });
  const dirty = Object.keys(patch).length > 0;
  const kind = connection?.type ?? type;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (name.trim() === '') {
      setFormError('connections.error.nameRequired');
      return;
    }
    if (baseUrl.trim() === '') {
      setFormError('connections.error.addressRequired');
      return;
    }
    if (hasStoredKey && keyMode === KEY_MODE.REPLACE && newKey.trim() === '') {
      setFormError('connections.error.keyRequired');
      return;
    }
    setFormError(undefined);
    if (connection === undefined) {
      const key = newKey.trim();
      create.mutate({
        data: {
          name: name.trim(),
          type,
          baseUrl: baseUrl.trim(),
          enabled: true,
          ...(key === '' ? {} : { apiKey: key }),
        },
      });
      return;
    }
    if (!dirty) {
      onClose();
      return;
    }
    update.mutate({ id: connection.id, data: patch });
  }

  const saveFailed = create.isError || update.isError;
  const saveFailure: unknown = create.isError ? create.error : update.error;
  const errorKey =
    formError ??
    (saveFailed
      ? errorMessageKey(saveFailure, {
          400: 'connections.error.invalid',
          409: 'connections.error.nameTaken',
          422: 'connections.error.addressRejected',
        })
      : undefined);

  const tested = test.data?.status === 200 ? test.data.data : undefined;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>
              {t(
                connection === undefined
                  ? 'connections.form.createTitle'
                  : 'connections.form.editTitle'
              )}
            </DialogTitle>
            <DialogDescription>
              {t(
                connection === undefined
                  ? 'connections.form.createHint'
                  : 'connections.form.editHint'
              )}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={nameId}>{t('connections.form.name')}</FieldLabel>
              <Input
                id={nameId}
                autoComplete="off"
                maxLength={80}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            </Field>
            <Field>
              {connection === undefined ? (
                <>
                  <FieldLabel htmlFor={typeId}>{t('connections.form.type')}</FieldLabel>
                  <NativeSelect
                    id={typeId}
                    value={type}
                    onChange={(event) => {
                      setType(
                        parseType(event.target.value) ?? CreateProviderConnectionDtoType.ollama
                      );
                    }}
                  >
                    {Object.values(CreateProviderConnectionDtoType).map((value) => (
                      <NativeSelectOption key={value} value={value}>
                        {t(`connections.type.${value}`)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </>
              ) : (
                <>
                  {/* The kind of a saved provider is read-only, so there is no control to label. */}
                  <span className="text-sm font-medium">{t('connections.form.type')}</span>
                  <p className="text-sm">{t(`connections.type.${connection.type}`)}</p>
                </>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor={addressId}>{t('connections.form.address')}</FieldLabel>
              <Input
                id={addressId}
                autoComplete="off"
                spellCheck={false}
                maxLength={2048}
                value={baseUrl}
                onChange={(event) => {
                  setBaseUrl(event.target.value);
                }}
              />
              <FieldDescription>{t(`connections.form.addressHint.${kind}`)}</FieldDescription>
            </Field>
            {keyMode === KEY_MODE.REPLACE ? (
              <Field>
                <FieldLabel htmlFor={keyId}>
                  {t(hasStoredKey ? 'connections.form.newKey' : 'connections.form.key')}
                </FieldLabel>
                <Input
                  id={keyId}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={newKey}
                  onChange={(event) => {
                    setNewKey(event.target.value);
                  }}
                />
                {hasStoredKey && (
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setNewKey('');
                        setKeyMode(KEY_MODE.KEEP);
                      }}
                    >
                      {t('connections.form.keyReplaceCancel')}
                    </Button>
                  </div>
                )}
              </Field>
            ) : (
              <Field>
                <p className="text-sm">
                  {t(
                    keyMode === KEY_MODE.REMOVE
                      ? 'connections.form.keyWillRemove'
                      : 'connections.form.keyStored'
                  )}
                </p>
                <div className="flex gap-2">
                  {keyMode === KEY_MODE.KEEP ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setKeyMode(KEY_MODE.REPLACE);
                        }}
                      >
                        {t('connections.form.keyReplace')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setKeyMode(KEY_MODE.REMOVE);
                        }}
                      >
                        {t('connections.form.keyRemove')}
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setKeyMode(KEY_MODE.KEEP);
                      }}
                    >
                      {t('connections.form.keyUndo')}
                    </Button>
                  )}
                </div>
              </Field>
            )}
          </FieldGroup>
          {connection !== undefined && (
            <div className="space-y-2">
              <Button
                type="button"
                variant="outline"
                disabled={test.isPending || dirty || pending}
                onClick={() => {
                  test.mutate({ id: connection.id });
                }}
              >
                {test.isPending ? t('connections.test.running') : t('connections.test.action')}
              </Button>
              {dirty && (
                <p className="text-muted-foreground text-sm">{t('connections.test.dirty')}</p>
              )}
              {!dirty && tested !== undefined && (
                <p role="status" className="text-sm">
                  {t('connections.test.ok', { count: tested.modelCount })}
                </p>
              )}
              {!dirty && test.isError && (
                <Alert variant="destructive">
                  <AlertDescription>{t(testFailureKey(test.error))}</AlertDescription>
                </Alert>
              )}
            </div>
          )}
          {errorKey !== undefined && (
            <Alert variant="destructive">
              <AlertDescription>{t(errorKey)}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {connection === undefined
                ? t(pending ? 'connections.form.creating' : 'connections.form.createSubmit')
                : t(pending ? 'connections.form.saving' : 'connections.form.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
