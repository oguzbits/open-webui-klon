export const FILE_STORAGE = Symbol('FILE_STORAGE');

/** `get` of a key that has no file; any other failure of the disk is thrown as it is. */
export class FileNotFoundError extends Error {
  constructor() {
    super('The file is not in the storage');
    this.name = FileNotFoundError.name;
  }
}

/** Where uploaded files live. Keys are UUIDs chosen by the server, never anything the client sent. */
export interface FileStorage {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  /** Removing a file that is not there is not an error. */
  remove(key: string): Promise<void>;
}
