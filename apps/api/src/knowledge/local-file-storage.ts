import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { FileNotFoundError, type FileStorage } from './file-storage.js';

const KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Files in one directory. A key that is not a UUID is refused, so no key can leave the directory. */
export class LocalFileStorage implements FileStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const target = this.pathOf(key);
    await mkdir(this.root, { recursive: true });
    // Write beside the target and rename: a reader never sees half a file, a crash leaves only a .tmp file.
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, bytes, { flag: 'wx' });
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  async get(key: string): Promise<Uint8Array> {
    const path = this.pathOf(key);
    try {
      return await readFile(path);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new FileNotFoundError();
      }
      throw error;
    }
  }

  async remove(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true });
  }

  private pathOf(key: string): string {
    if (!KEY_PATTERN.test(key)) throw new Error('Invalid storage key');
    return join(this.root, key);
  }
}
