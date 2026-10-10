import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalFileStorage } from './local-file-storage.js';

describe('LocalFileStorage', () => {
  let dir: string;
  let storage: LocalFileStorage;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'owui-storage-'));
    storage = new LocalFileStorage(join(dir, 'files'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('stores and returns the bytes, creating the directory on first use', async () => {
    const key = randomUUID();

    await storage.put(key, new TextEncoder().encode('Hallo'));

    expect(new TextDecoder().decode(await storage.get(key))).toBe('Hallo');
    expect(await readdir(join(dir, 'files'))).toEqual([key]);
  });

  it.each(['../x', 'a/b', '', '..', `${randomUUID()}/../x`, 'not-a-uuid'])(
    'refuses the key %j in every method',
    async (key) => {
      const bytes = new Uint8Array([1]);

      await expect(storage.put(key, bytes)).rejects.toThrow('Invalid storage key');
      await expect(storage.get(key)).rejects.toThrow('Invalid storage key');
      await expect(storage.remove(key)).rejects.toThrow('Invalid storage key');
    }
  );

  it('removes a file and does not mind a file that is not there', async () => {
    const key = randomUUID();
    await storage.put(key, new Uint8Array([1]));

    await storage.remove(key);
    await expect(storage.remove(key)).resolves.toBeUndefined();

    expect(await readdir(join(dir, 'files'))).toEqual([]);
  });

  it('leaves no temporary file behind when the write fails', async () => {
    const key = randomUUID();
    // A directory at the target makes the final rename fail.
    await mkdir(join(dir, 'files', key), { recursive: true });

    await expect(storage.put(key, new Uint8Array([2]))).rejects.toThrow();

    expect((await readdir(join(dir, 'files'))).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});
