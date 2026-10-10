import { useChat } from '@ai-sdk/react';
import { useQueryClient } from '@tanstack/react-query';
import type { UIMessage } from 'ai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router';

import { ApiError } from '@/api/fetcher';
import { getChatsDetailQueryKey, getChatsListQueryKey, useChatsUpdate } from '@/api/generated/api';
import type { ChatDetailDto } from '@/api/generated/model';
import { LoadError } from '@/components/common/load-error';
import { PageLoading } from '@/components/common/page-loading';
import { Button } from '@/components/ui/button';
import { useLatest } from '@/hooks/use-latest';

import { chatErrorKey, isStreamFailure } from './chat-errors';
import { readFirstMessage } from './chat-navigation';
import { type ChatSettings, ChatSettingsDialog } from './chat-settings-dialog';
import { createChatTransport } from './chat-transport';
import { Composer } from './composer';
import { chatTitle } from './delete-chat-dialog';
import { type EditRestore, MessageItem } from './message-item';
import { activePath, branchesOf, serverMessageId, toUiMessage } from './message-tree';
import { ModelPicker } from './model-picker';
import { useChatDetail } from './use-chat-detail';
import { useTitlePolling } from './use-title-polling';

/**
 * After a stop or a lost connection the server stores the partial answer when its own stream closes, a moment after
 * the browser let go. Reloading sooner would replace the visible text by a chat without it. A heuristic, checked by
 * hand (Task 11).
 */
const ABORT_SETTLE_MS = 500;
const THROTTLE_MS = 50;

const REQUEST_KIND = { SEND: 'send', EDIT: 'edit', REGENERATE: 'regenerate' } as const;

type LastRequest =
  | { kind: typeof REQUEST_KIND.SEND; text: string }
  | { kind: typeof REQUEST_KIND.EDIT; text: string; messageId: string }
  | { kind: typeof REQUEST_KIND.REGENERATE };

interface Restore {
  token: number;
  text: string;
}

function noop() {
  // Placeholder until the first render has set the real function.
}

/** The server announced its ids in the first part of the stream: from then on it has stored the question. */
function questionIsStored(last: UIMessage | undefined): boolean {
  return last?.role === 'assistant' && serverMessageId(last) !== last.id;
}

export function ChatSession({ chat, syncToken }: { chat: ChatDetailDto; syncToken: number }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [composerRestore, setComposerRestore] = useState<Restore>();
  const [editRestore, setEditRestore] = useState<Restore & { messageId: string }>();
  const lastRequest = useRef<LastRequest | undefined>(undefined);
  const sending = useRef(false);
  const switching = useRef(false);
  const restoreToken = useRef(0);
  const appliedToken = useRef(syncToken);
  const firstSent = useRef(false);
  // What the callbacks of useChat need from later in this render; set by an effect below.
  const latest = useRef<{ messages: UIMessage[]; resync: () => void }>({
    messages: [],
    resync: noop,
  });
  const chatNow = useLatest(chat);

  const invalidateChat = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: getChatsDetailQueryKey(chat.id) });
    void queryClient.invalidateQueries({ queryKey: getChatsListQueryKey() });
  }, [queryClient, chat.id]);
  const invalidateNow = useLatest(invalidateChat);

  const [initialMessages] = useState(() => activePath(chat).map(toUiMessage));
  const transport = useMemo(() => createChatTransport(chat.id), [chat.id]);

  const { messages, status, error, sendMessage, regenerate, stop, setMessages, clearError } =
    useChat<UIMessage>({
      id: chat.id,
      transport,
      messages: initialMessages,
      throttle: THROTTLE_MS,
      onError: (caught) => {
        // An error inside the stream: the answer is stored with status error; the reload shows it with its note.
        if (isStreamFailure(caught)) return;
        // The server has the question already (the stream began, then the connection broke): nothing to give back.
        if (questionIsStored(latest.current.messages.at(-1))) return;
        // The request failed before an answer began: drop the optimistic message and give the text back.
        latest.current.resync();
        const request = lastRequest.current;
        restoreToken.current += 1;
        if (request?.kind === REQUEST_KIND.SEND) {
          setComposerRestore({ token: restoreToken.current, text: request.text });
        }
        if (request?.kind === REQUEST_KIND.EDIT) {
          setEditRestore({
            token: restoreToken.current,
            text: request.text,
            messageId: request.messageId,
          });
        }
      },
      onFinish: ({ isAbort, isDisconnect }) => {
        // Also runs after errors. The stream is closed here, so the server has stored what it will store.
        const delay = isAbort || isDisconnect ? ABORT_SETTLE_MS : 0;
        window.setTimeout(() => {
          invalidateNow.current();
        }, delay);
      },
    });

  useEffect(() => {
    latest.current = {
      messages,
      resync: () => {
        setMessages(activePath(chatNow.current).map(toUiMessage));
      },
    };
  });

  const busy = status === 'submitted' || status === 'streaming';
  const idle = !busy;

  // The reload brought a newer chat: show its branch, unless something is running.
  useEffect(() => {
    if (!idle || appliedToken.current === syncToken) return;
    appliedToken.current = syncToken;
    switching.current = false;
    setMessages(activePath(chat).map(toUiMessage));
    if (isStreamFailure(error)) clearError();
  }, [idle, syncToken, chat, error, setMessages, clearError]);

  useEffect(() => {
    // A second action in the same tick sees the ref; the status catches up one render later.
    if (idle) sending.current = false;
  }, [idle]);

  useTitlePolling(chat, idle);

  const branchUpdate = useChatsUpdate();
  const modelUpdate = useChatsUpdate();
  const settingsUpdate = useChatsUpdate();
  const { mutate: switchBranch } = branchUpdate;
  const { mutate: changeModel } = modelUpdate;
  const { mutateAsync: saveSettingsRequest } = settingsUpdate;
  const locked = busy || branchUpdate.isPending;

  const send = useCallback(
    (request: Exclude<LastRequest, { kind: typeof REQUEST_KIND.REGENERATE }>) => {
      if (sending.current) return;
      sending.current = true;
      lastRequest.current = request;
      setComposerRestore(undefined);
      setEditRestore(undefined);
      void (request.kind === REQUEST_KIND.EDIT
        ? sendMessage({ text: request.text, messageId: request.messageId })
        : sendMessage({ text: request.text }));
    },
    [sendMessage]
  );

  const handleSend = useCallback(
    (text: string) => {
      send({ kind: REQUEST_KIND.SEND, text });
    },
    [send]
  );

  const handleEdit = useCallback(
    (messageId: string, text: string) => {
      send({ kind: REQUEST_KIND.EDIT, text, messageId });
    },
    [send]
  );

  const handleRegenerate = useCallback(
    (messageId: string) => {
      if (sending.current) return;
      sending.current = true;
      lastRequest.current = { kind: REQUEST_KIND.REGENERATE };
      setEditRestore(undefined);
      void regenerate({ messageId });
    },
    [regenerate]
  );

  const handleSwitch = useCallback(
    (messageId: string) => {
      // Like `sending`: a second click comes before `isPending` disables the buttons, or after the switch but before
      // the reload has replaced the old branch. The guard holds until the reloaded chat is shown (sync effect above).
      if (switching.current) return;
      switching.current = true;
      setEditRestore(undefined);
      switchBranch(
        { id: chat.id, data: { activeMessageId: messageId } },
        {
          onSuccess: invalidateChat,
          onError: () => {
            switching.current = false;
          },
        }
      );
    },
    [switchBranch, chat.id, invalidateChat]
  );

  const handleStop = useCallback(() => {
    void stop();
  }, [stop]);

  const handleModelChange = useCallback(
    (modelId: string) => {
      changeModel({ id: chat.id, data: { modelId } }, { onSuccess: invalidateChat });
    },
    [changeModel, chat.id, invalidateChat]
  );

  const saveSettings = useCallback(
    async (next: ChatSettings) => {
      await saveSettingsRequest({
        id: chat.id,
        data: { systemPrompt: next.systemPrompt, params: next.params },
      });
      invalidateChat();
    },
    [saveSettingsRequest, chat.id, invalidateChat]
  );

  // The first message of a freshly created chat comes along in the router state: send it once, then drop the state
  // so a reload does not send it again (StrictMode runs this effect twice; the ref makes the second run a no-op).
  const firstMessage = readFirstMessage(location.state);
  useEffect(() => {
    if (firstMessage === undefined || firstSent.current) return;
    firstSent.current = true;
    void navigate(location.pathname, { replace: true, state: null });
    send({ kind: REQUEST_KIND.SEND, text: firstMessage });
  }, [firstMessage, location.pathname, navigate, send]);

  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, busy]);

  const storedById = useMemo(
    () => new Map(chat.messages.map((message) => [message.id, message])),
    [chat.messages]
  );
  const branches = useMemo(() => branchesOf(chat.messages), [chat.messages]);

  const mutationFailed = branchUpdate.isError || modelUpdate.isError;
  const mutationError = branchUpdate.isError ? branchUpdate.error : modelUpdate.error;

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col gap-4">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold wrap-break-word">
          {chatTitle(chat.title, t('chats.untitled'))}
        </h1>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <ModelPicker
            value={chat.modelId}
            disabled={locked || modelUpdate.isPending}
            onChange={handleModelChange}
          />
          <ChatSettingsDialog
            value={{ systemPrompt: chat.systemPrompt, params: chat.params }}
            onSave={saveSettings}
          />
        </div>
      </header>
      <ol aria-label={t('chats.messages')} className="flex-1 space-y-6">
        {messages.map((message, index) => {
          const restore: EditRestore | undefined =
            editRestore?.messageId === message.id ? editRestore : undefined;
          return (
            <MessageItem
              key={message.id}
              message={message}
              stored={storedById.get(message.id)}
              branch={branches.get(message.id)}
              live={busy && index === messages.length - 1 && message.role === 'assistant'}
              locked={locked}
              restore={restore}
              onRegenerate={handleRegenerate}
              onEdit={handleEdit}
              onSwitch={handleSwitch}
            />
          );
        })}
        {status === 'submitted' && (
          <li role="status" className="text-muted-foreground text-sm">
            {t('chats.message.pending')}
          </li>
        )}
      </ol>
      <div className="bg-background sticky bottom-0 space-y-2 pb-2">
        {status === 'error' && error !== undefined && (
          <p role="alert" className="text-destructive text-sm">
            {t(chatErrorKey(error))}
          </p>
        )}
        {mutationFailed && (
          <p role="alert" className="text-destructive text-sm">
            {t(chatErrorKey(mutationError))}
          </p>
        )}
        <Composer
          key={composerRestore?.token ?? 0}
          busy={busy}
          disabled={false}
          initialText={composerRestore?.text}
          onSend={handleSend}
          onStop={handleStop}
        />
      </div>
      <div ref={end} />
    </div>
  );
}

export function ChatView({ chatId }: { chatId: string }) {
  const { t } = useTranslation();
  const detail = useChatDetail(chatId);

  if (detail.isPending) return <PageLoading />;
  if (detail.data === undefined) {
    if (detail.error instanceof ApiError && detail.error.status === 404) {
      return (
        <div className="mx-auto max-w-3xl space-y-3">
          <p role="alert">{t('chats.error.gone')}</p>
          <Button asChild variant="outline" size="sm">
            <Link to="/chats">{t('chats.list.new')}</Link>
          </Button>
        </div>
      );
    }
    return (
      <LoadError
        error={detail.error}
        busy={detail.isFetching}
        onRetry={() => {
          void detail.refetch();
        }}
      />
    );
  }
  return (
    <>
      {detail.isRefetchError && (
        <LoadError
          error={detail.error}
          busy={detail.isFetching}
          onRetry={() => {
            void detail.refetch();
          }}
        />
      )}
      <ChatSession chat={detail.data} syncToken={detail.dataUpdatedAt} />
    </>
  );
}
