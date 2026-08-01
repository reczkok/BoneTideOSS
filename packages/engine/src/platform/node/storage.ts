import type { PlatformStorage } from '../contract/storage.ts';

const store = new Map<string, string>();

export const storage: PlatformStorage = {
  get(key) {
    return store.get(key) ?? null;
  },
  set(key, value) {
    store.set(key, value);
  },
  remove(key) {
    store.delete(key);
  },
};
