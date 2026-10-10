import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';

import { errorMessageKey } from '@/api/error-message';
import { useChatsCreate } from '@/api/generated/api';
import { LoadError } from '@/components/common/load-error';
import { PageLoading } from '@/components/common/page-loading';
import { Button } from '@/components/ui/button';
import { useModels } from '@/features/models/use-models';

import { firstMessageState } from './chat-navigation';
import { type ChatSettings, ChatSettingsDialog } from './chat-settings-dialog';
import { Composer } from './composer';
import { ModelPicker } from './model-picker';

interface Restore {
  token: number;
  text: string;
}

function nothingToStop() {
  // Creating a chat is quick and cannot be stopped; the composer is only blocked while it runs.
}

export function NewChat() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const models = useModels();
  const create = useChatsCreate();
  const [chosen, setChosen] = useState<string>();
  const [settings, setSettings] = useState<ChatSettings>({ systemPrompt: null, params: {} });
  const [restore, setRestore] = useState<Restore>();

  if (models.isPending) return <PageLoading />;
  if (models.isError) {
    return (
      <LoadError
        error={models.error}
        busy={models.isFetching}
        onRetry={() => {
          void models.refetch();
        }}
      />
    );
  }

  const [first] = models.data.models;
  if (first === undefined) {
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        <h1 className="text-2xl font-semibold">{t('chats.new.title')}</h1>
        <p>
          {models.data.unavailableConnections.length > 0
            ? t('chats.new.noModelsReachable')
            : t('chats.new.noModels')}
        </p>
        <Button asChild variant="outline" size="sm">
          <Link to="/models">{t('chats.new.toModels')}</Link>
        </Button>
      </div>
    );
  }
  const modelId = chosen ?? first.id;

  function start(text: string) {
    create.mutate(
      { data: { modelId, systemPrompt: settings.systemPrompt, params: settings.params } },
      {
        onSuccess: (response) => {
          // Only 201 is ever returned here (apiFetch throws the rest).
          if (response.status === 201) {
            void navigate(`/chats/${response.data.id}`, { state: firstMessageState(text) });
          }
        },
        onError: () => {
          setRestore((previous) => ({ token: (previous?.token ?? 0) + 1, text }));
        },
      }
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{t('chats.new.title')}</h1>
        <p className="text-muted-foreground text-sm">{t('chats.new.intro')}</p>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <ModelPicker value={modelId} disabled={create.isPending} onChange={setChosen} />
          <ChatSettingsDialog
            value={settings}
            onSave={(next) => {
              setSettings(next);
              return Promise.resolve();
            }}
          />
        </div>
      </header>
      {create.isError && (
        <p role="alert" className="text-destructive text-sm">
          {/* Creating sends no message yet: a 422 is about the instruction or the parameters. */}
          {t(
            errorMessageKey(create.error, {
              404: 'chats.error.gone',
              422: 'chats.settings.tooLong',
            })
          )}
        </p>
      )}
      {create.isPending && (
        <p role="status" className="text-muted-foreground text-sm">
          {t('chats.new.creating')}
        </p>
      )}
      <Composer
        key={restore?.token ?? 0}
        busy={false}
        disabled={create.isPending}
        initialText={restore?.text}
        onSend={start}
        onStop={nothingToStop}
      />
    </div>
  );
}
