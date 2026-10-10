import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useMatch, useNavigate } from 'react-router';

import { errorMessageKey } from '@/api/error-message';
import { getChatsDetailQueryKey, getChatsListQueryKey, useChatsRemove } from '@/api/generated/api';
import type { ChatSummaryDto } from '@/api/generated/model';
import { LoadError } from '@/components/common/load-error';
import { Button } from '@/components/ui/button';
import {
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from '@/components/ui/sidebar';
import { useDebouncedValue } from '@/hooks/use-debounced-value';

import { chatTitle, DeleteChatDialog } from './delete-chat-dialog';
import { useChatList } from './use-chat-list';

const SEARCH_DEBOUNCE_MS = 300;

export function ChatList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const openId = useMatch('/chats/:id')?.params.id;
  const [search, setSearch] = useState('');
  const query = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);
  const list = useChatList(query);
  const remove = useChatsRemove();

  function removeChat(chat: ChatSummaryDto) {
    remove.mutate(
      { id: chat.id },
      {
        onSuccess: () => {
          if (openId === chat.id) {
            // Leave first: the open view must not refetch a chat that is gone.
            void navigate('/chats');
            queryClient.removeQueries({ queryKey: getChatsDetailQueryKey(chat.id) });
          }
          void queryClient.invalidateQueries({ queryKey: getChatsListQueryKey() });
        },
      }
    );
  }

  const chats = list.data?.pages.flatMap((page) => page.items) ?? [];
  const untitled = t('chats.untitled');

  return (
    <div className="space-y-2">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton asChild>
            <NavLink to="/chats" end>
              <Plus aria-hidden />
              <span>{t('chats.list.new')}</span>
            </NavLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      <SidebarInput
        type="search"
        value={search}
        maxLength={200}
        aria-label={t('chats.list.search')}
        placeholder={t('chats.list.search')}
        onChange={(event) => {
          setSearch(event.target.value);
        }}
      />
      {remove.isError && (
        <p role="alert" className="text-destructive px-2 text-xs">
          {t('chats.list.delete.failed')} {t(errorMessageKey(remove.error))}
        </p>
      )}
      {list.isPending ? (
        <div role="status">
          <SidebarMenuSkeleton />
          <span className="sr-only">{t('common.loading')}</span>
        </div>
      ) : list.isError ? (
        <LoadError
          error={list.error}
          busy={list.isFetching}
          onRetry={() => {
            void list.refetch();
          }}
        />
      ) : chats.length === 0 ? (
        <p className="text-muted-foreground px-2 text-sm">
          {query.trim() === '' ? t('chats.list.empty') : t('chats.list.noMatches')}
        </p>
      ) : (
        <SidebarMenu>
          {chats.map((chat) => (
            <SidebarMenuItem key={chat.id}>
              <SidebarMenuButton asChild isActive={chat.id === openId}>
                <NavLink to={`/chats/${chat.id}`}>
                  <span className="truncate">{chatTitle(chat.title, untitled)}</span>
                </NavLink>
              </SidebarMenuButton>
              <DeleteChatDialog
                chat={chat}
                busy={remove.isPending}
                onConfirm={() => {
                  removeChat(chat);
                }}
              />
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      )}
      {list.hasNextPage && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          disabled={list.isFetchingNextPage}
          onClick={() => {
            void list.fetchNextPage();
          }}
        >
          {list.isFetchingNextPage ? t('chats.list.loadingMore') : t('chats.list.more')}
        </Button>
      )}
    </div>
  );
}
