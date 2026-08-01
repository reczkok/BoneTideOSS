import { SLOT_LABELS } from '@bonetide/engine/config.ts';
import { SHELL_KEYS } from './app.ts';
import { type Action, KEY_BINDINGS, MOVE_KEYS } from './input.ts';

const GLYPHS: Record<string, string> = {
  Escape: 'Esc',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};
const codeLabel = (code: string) => GLYPHS[code] ?? (code.startsWith('Key') ? code.slice(3) : code);

const codesOf = (action: Action) =>
  Object.keys(KEY_BINDINGS).filter((code) => KEY_BINDINGS[code] === action);

const MOVE_ORDER = [MOVE_KEYS.up, MOVE_KEYS.left, MOVE_KEYS.down, MOVE_KEYS.right];
const wasdLabel = MOVE_ORDER.map((pair) => codeLabel(pair[0])).join(' ');
const arrowsLabel = MOVE_ORDER.map((pair) => codeLabel(pair[1])).join(' ');

export function createKeymapUi(deps: { close(): void }) {
  const rowsEl = document.getElementById('keymap-rows') as HTMLElement;

  const section = (title: string) => {
    const h = document.createElement('div');
    h.className = 'opt-section';
    h.textContent = title;
    rowsEl.append(h);
  };

  const row = (label: string, keys: string[], note?: string) => {
    const el = document.createElement('div');
    el.className = 'opt-row';
    const name = document.createElement('span');
    name.className = 'opt-label';
    name.textContent = label;
    const group = document.createElement('div');
    group.className = 'keymap-keys';
    for (const k of keys) {
      const cap = document.createElement('span');
      cap.className = 'key-cap';
      cap.textContent = k;
      group.append(cap);
    }
    if (note) {
      const n = document.createElement('span');
      n.className = 'keymap-note';
      n.textContent = note;
      group.append(n);
    }
    el.append(name, group);
    rowsEl.append(el);
  };

  section('combat');
  row('move', [wasdLabel, arrowsLabel]);
  row('swing sword', ['LMB'], 'aims at the cursor');
  row('dash', codesOf('dash').map(codeLabel));
  row('nova (ultimate)', [...codesOf('ult').map(codeLabel), 'RMB']);
  row('ability slots', [...SLOT_LABELS]);

  section('interface');
  row('ability tree', SHELL_KEYS.tree.map(codeLabel));
  row('pause', SHELL_KEYS.pause.map(codeLabel));
  row('this screen', [...SHELL_KEYS.keymap]);

  section('ability tree');
  row('browse nodes', [wasdLabel, arrowsLabel], 'or point and click');
  row('buy selected', ['Space'], 'or click the node again');
  row('back to the fight', [...SHELL_KEYS.tree.map(codeLabel), 'Esc']);

  (document.getElementById('keymap-back') as HTMLElement).addEventListener('click', deps.close);
}
