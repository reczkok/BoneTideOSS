import { SLOT_CODES } from '@bonetide/engine/config.ts';
import type { Action, Input, SlotAction } from '@bonetide/engine/game/input.ts';

export type { Action, Input, SlotAction };

export const KEY_BINDINGS: Record<string, Action> = {
  Space: 'dash',
  KeyQ: 'ult',
  ...Object.fromEntries(SLOT_CODES.map((code, i) => [code, `slot${i}` as SlotAction])),
};

export const MOVE_KEYS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
} as const;

export function createInput(canvas: HTMLCanvasElement, isGameplay: () => boolean): Input {
  const keys = new Set<string>();
  const queued = new Set<Action>();
  const pointer = { x: 0, y: 0, down: false };
  const virtualMove = { x: 0, z: 0 };
  const moveScratch: [number, number] = [0, 0];
  const touchMode = matchMedia('(pointer: coarse)').matches;

  window.addEventListener('keydown', (e) => {
    const action = KEY_BINDINGS[e.code];
    if (action && isGameplay()) {
      queued.add(action);
      if (e.code === 'Space') e.preventDefault();
    }
    keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointermove', (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
  });
  canvas.addEventListener('pointerdown', (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    if (!isGameplay()) return;
    if (touchMode && e.pointerType === 'touch') return;
    if (e.button === 2) {
      queued.add('ult');
    } else {
      pointer.down = true;
    }
  });
  window.addEventListener('pointerup', (e) => {
    if (e.button !== 2) pointer.down = false;
  });

  return {
    pointer,
    queue(action) {
      queued.add(action);
    },
    setVirtualMove(x: number, z: number) {
      const len = Math.hypot(x, z);
      virtualMove.x = len > 1 ? x / len : x;
      virtualMove.z = len > 1 ? z / len : z;
    },
    isTouchMode() {
      return touchMode;
    },
    consume(action) {
      const had = queued.has(action);
      queued.delete(action);
      return had;
    },
    clear() {
      queued.clear();
    },
    moveAxis() {
      let mx = 0;
      let mz = 0;
      if (keys.has(MOVE_KEYS.up[0]) || keys.has(MOVE_KEYS.up[1])) mz -= 1;
      if (keys.has(MOVE_KEYS.down[0]) || keys.has(MOVE_KEYS.down[1])) mz += 1;
      if (keys.has(MOVE_KEYS.left[0]) || keys.has(MOVE_KEYS.left[1])) mx -= 1;
      if (keys.has(MOVE_KEYS.right[0]) || keys.has(MOVE_KEYS.right[1])) mx += 1;
      if (virtualMove.x !== 0 || virtualMove.z !== 0) {
        mx = virtualMove.x;
        mz = virtualMove.z;
      }
      const len = Math.hypot(mx, mz);
      moveScratch[0] = len > 0 ? mx / len : 0;
      moveScratch[1] = len > 0 ? mz / len : 0;
      return moveScratch;
    },
  };
}
