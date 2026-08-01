import { createMMKV } from 'react-native-mmkv';
import type { PlatformStorage } from '@bonetide/engine/platform/contract/storage.ts';

const mmkv = createMMKV();

export const storage: PlatformStorage = {
  get(key: string): string | null {
    return mmkv.getString(key) ?? null;
  },
  set(key: string, value: string) {
    mmkv.set(key, value);
  },
  remove(key: string) {
    mmkv.remove(key);
  },
};
