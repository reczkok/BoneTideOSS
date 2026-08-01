import { storage } from '#platform/storage.ts';

const TREE_HINT_KEY = 'bonetide.tree-hint.v3';

export const treeHintSeen = () => {
  try {
    return storage.get(TREE_HINT_KEY) === '1';
  } catch {
    return false;
  }
};

export const markTreeHintSeen = () => {
  try {
    storage.set(TREE_HINT_KEY, '1');
  } catch {}
};
