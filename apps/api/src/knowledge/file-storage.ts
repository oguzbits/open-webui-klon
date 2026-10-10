export const FILE_STORAGE = Symbol('FILE_STORAGE');

/** Where uploaded files live. Keys are UUIDs chosen by the server, never anything the client sent. */
export interface FileStorage {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  /** Removing a file that is not there is not an error. */
  remove(key: string): Promise<void>;
}
