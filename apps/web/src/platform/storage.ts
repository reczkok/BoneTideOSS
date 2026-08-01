import type { PlatformStorage } from '@bonetide/engine/platform/contract/storage.ts';

export const storage: PlatformStorage = {
  get(key) {
    return localStorage.getItem(key);
  },
  set(key, value) {
    localStorage.setItem(key, value);
  },
  remove(key) {
    localStorage.removeItem(key);
  },
};
