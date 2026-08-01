import { normalize2 } from '../core/mathx.ts';

export type SlotAction = 'slot0' | 'slot1' | 'slot2' | 'slot3' | 'slot4';
export type Action = 'dash' | 'ult' | SlotAction;

export interface Input {
  pointer: { x: number; y: number; down: boolean };
  queue(action: Action): void;
  setVirtualMove(x: number, z: number): void;
  isTouchMode(): boolean;
  consume(action: Action): boolean;
  moveAxis(): [number, number];
  clear(): void;
}

export function createInput(isGameplay: () => boolean): Input {
  const queued = new Set<Action>();
  const pointer = { x: 0, y: 0, down: false };
  const virtualMove = { x: 0, z: 0 };
  const moveScratch: [number, number] = [0, 0];

  return {
    pointer,
    queue(action) {
      if (isGameplay()) queued.add(action);
    },
    setVirtualMove(x: number, z: number) {
      const [nx, nz, len] = normalize2(x, z);
      virtualMove.x = len > 1 ? nx : x;
      virtualMove.z = len > 1 ? nz : z;
    },
    isTouchMode() {
      return true;
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
      const [nx, nz] = normalize2(virtualMove.x, virtualMove.z);
      moveScratch[0] = nx;
      moveScratch[1] = nz;
      return moveScratch;
    },
  };
}
