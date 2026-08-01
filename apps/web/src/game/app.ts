import { createApp as createEngineApp } from '@bonetide/engine/game/app.ts';
import type { App, AppState } from '@bonetide/engine/game/app.ts';

export type { App, AppState };

export const SHELL_KEYS = {
  tree: ['KeyT', 'KeyC'],
  pause: ['Escape', 'KeyP'],
  keymap: ['?'],
} as const;

const SCREENS: Record<AppState, string | null> = {
  menu: 'overlay',
  playing: null,
  tree: 'treescreen',
  paused: 'pausemenu',
  dead: 'gameover',
  options: 'options',
  keymap: 'keymap',
};

export function createApp(): App {
  const el = (id: string) => document.getElementById(id) as HTMLElement;
  const hud = el('hud');
  const screens = new Map<AppState, HTMLElement>();
  for (const [state, id] of Object.entries(SCREENS)) {
    if (id) screens.set(state as AppState, el(id));
  }

  const app = createEngineApp();

  const applyScreens = () => {
    for (const [s, screen] of screens) {
      screen.classList.toggle('hidden', s !== app.state);
    }
    hud.classList.toggle('hidden', app.state === 'menu');
  };
  app.subscribe(applyScreens);
  applyScreens();

  window.addEventListener('keydown', (e) => {
    if ((SHELL_KEYS.tree as readonly string[]).includes(e.code)) {
      if (app.state === 'playing') app.to('tree');
      else if (app.state === 'tree') app.to('playing');
      return;
    }
    if (e.key === SHELL_KEYS.keymap[0]) {
      if (app.state === 'keymap') app.back();
      else if (app.state === 'menu' || app.state === 'playing' || app.state === 'paused') {
        app.to('keymap');
      }
      return;
    }
    if (!(SHELL_KEYS.pause as readonly string[]).includes(e.code)) return;
    if (app.state === 'playing') app.to('paused');
    else if (app.state === 'paused') app.to('playing');
    else if (app.state === 'tree') app.to('playing');
    else if (app.state === 'options' || app.state === 'keymap') app.back();
  });

  return app;
}
