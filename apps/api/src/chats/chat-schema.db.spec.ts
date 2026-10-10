import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { buildDataSourceOptions } from '../database/data-source-options.js';
import { insertChat, insertMessage, resetChatTables } from '../testing/chat-fixtures.js';
import { insertUser, resetAuthTables } from '../testing/db-fixtures.js';
import { MESSAGE_ROLE } from './chat-dictionaries.js';

describe('chat schema (database)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource(buildDataSourceOptions(testDatabaseUrl()));
    await dataSource.initialize();
  });
  afterAll(async () => {
    await dataSource.destroy();
  });
  beforeEach(async () => {
    await resetAuthTables(dataSource);
    await resetChatTables(dataSource);
  });

  it('rejects an unknown role, status and title source', async () => {
    const user = await insertUser(dataSource);
    const chat = await insertChat(dataSource, user.id);

    await expect(
      insertMessage(dataSource, chat.id, { role: 'system' as typeof MESSAGE_ROLE.USER })
    ).rejects.toThrow(/message_role_check/);
    await expect(
      dataSource.query(`UPDATE chat SET title_source = 'robot' WHERE id = $1`, [chat.id])
    ).rejects.toThrow(/chat_title_source_check/);
  });

  it('deletes messages with their chat and chats with their user', async () => {
    const user = await insertUser(dataSource);
    const chat = await insertChat(dataSource, user.id);
    const root = await insertMessage(dataSource, chat.id);
    await insertMessage(dataSource, chat.id, { parentId: root.id, role: MESSAGE_ROLE.ASSISTANT });

    await dataSource.query('DELETE FROM app_user WHERE id = $1', [user.id]);

    expect(await dataSource.query('SELECT 1 FROM chat')).toHaveLength(0);
    expect(await dataSource.query('SELECT 1 FROM message')).toHaveLength(0);
  });

  it('clears active_leaf_id when its message is deleted, and deletes children of a deleted parent', async () => {
    const user = await insertUser(dataSource);
    const chat = await insertChat(dataSource, user.id);
    const root = await insertMessage(dataSource, chat.id);
    const child = await insertMessage(dataSource, chat.id, {
      parentId: root.id,
      role: MESSAGE_ROLE.ASSISTANT,
    });
    await dataSource.query('UPDATE chat SET active_leaf_id = $1 WHERE id = $2', [
      child.id,
      chat.id,
    ]);

    await dataSource.query('DELETE FROM message WHERE id = $1', [root.id]);

    const rows: { active_leaf_id: string | null }[] = await dataSource.query(
      'SELECT active_leaf_id FROM chat WHERE id = $1',
      [chat.id]
    );
    expect(rows[0]?.active_leaf_id).toBeNull();
    expect(await dataSource.query('SELECT 1 FROM message')).toHaveLength(0);
  });
});
