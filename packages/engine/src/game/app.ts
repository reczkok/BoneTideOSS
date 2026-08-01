export type AppState = 'menu' | 'playing' | 'tree' | 'paused' | 'dead' | 'options' | 'keymap';

const ALLOWED: Record<AppState, AppState[]> = {
  menu: ['playing', 'options', 'keymap'],
  playing: ['tree', 'paused', 'dead', 'keymap'],
  tree: ['playing'],
  paused: ['playing', 'menu', 'options', 'tree', 'keymap'],
  dead: ['playing', 'menu'],
  options: ['menu', 'paused'],
  keymap: ['menu', 'playing', 'paused'],
};

const RETURNABLE: AppState[] = ['options', 'keymap'];

export function createApp() {
  let state: AppState = 'menu';
  const returnTo = new Map<AppState, AppState>();
  const enterListeners = new Map<AppState, (() => void)[]>();
  const changeListeners = new Set<() => void>();

  function to(next: AppState) {
    if (next === state) return;
    if (!ALLOWED[state].includes(next)) {
      console.warn(`app: illegal transition ${state} -> ${next}`);
      return;
    }
    if (RETURNABLE.includes(next)) returnTo.set(next, state);
    state = next;
    for (const fn of enterListeners.get(state) ?? []) fn();
    for (const fn of changeListeners) fn();
  }

  function back() {
    if (RETURNABLE.includes(state)) to(returnTo.get(state) ?? 'menu');
  }

  return {
    get state() {
      return state;
    },
    openedFrom(s: AppState): AppState {
      return returnTo.get(s) ?? 'menu';
    },
    to,
    back,
    onEnter(s: AppState, fn: () => void) {
      const list = enterListeners.get(s) ?? [];
      list.push(fn);
      enterListeners.set(s, list);
    },
    subscribe(fn: () => void): () => void {
      changeListeners.add(fn);
      return () => changeListeners.delete(fn);
    },
  };
}

export type App = ReturnType<typeof createApp>;
