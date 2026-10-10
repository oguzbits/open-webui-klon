import type { DataSource } from 'typeorm';

import { MESSAGE_ROLE, MESSAGE_STATUS } from '../chats/chat-dictionaries.js';
import { Chat } from '../chats/chat.entity.js';
import { Message } from '../chats/message.entity.js';

/** Chats and messages disappear with their user (cascade), but tests of the chat tables alone reset them directly. */
export async function resetChatTables(dataSource: DataSource): Promise<void> {
  await dataSource.query('TRUNCATE chat CASCADE');
}

export async function insertChat(
  dataSource: DataSource,
  userId: string,
  overrides: Partial<Omit<Chat, 'user'>> = {}
): Promise<Chat> {
  const repository = dataSource.getRepository(Chat);
  return repository.save(
    repository.create({
      userId,
      title: null,
      modelId: 'connection:model',
      systemPrompt: null,
      params: {},
      ...overrides,
    })
  );
}

export async function insertMessage(
  dataSource: DataSource,
  chatId: string,
  overrides: Partial<Omit<Message, 'chat' | 'parent'>> = {}
): Promise<Message> {
  const repository = dataSource.getRepository(Message);
  return repository.save(
    repository.create({
      chatId,
      parentId: null,
      role: MESSAGE_ROLE.USER,
      parts: [{ type: 'text', text: 'Hallo' }],
      status: MESSAGE_STATUS.COMPLETE,
      ...overrides,
    })
  );
}
