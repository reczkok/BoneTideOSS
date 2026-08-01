import { TELEGRAPH } from '../config.ts';
import { TelegraphEntry, type CpuRecord } from '../core/schemas.ts';

export const TG_KIND = { arc: 0, circle: 1, line: 2 } as const;

const GATE = TELEGRAPH.lineWidth * 2 + TELEGRAPH.edgeWobble;

export function createTelegraphs() {
  const entries: CpuRecord<typeof TelegraphEntry>[] = Array.from({ length: TELEGRAPH.max }, () => ({
    pos: [0, 0],
    dir: [0, 1],
    radius: 0,
    halfArc: Math.PI,
    t0: 0,
    t1: -1,
    kind: 0,
    cosHalf: -1,
    cosFeatherIn: -1,
    boundSq: 0,
  }));
  const keys = new Int32Array(TELEGRAPH.max).fill(-1);
  let count = 0;

  const indexOf = (key: number) => {
    for (let i = 0; i < count; i++) {
      if (keys[i] === key) return i;
    }
    return -1;
  };

  const release = (i: number) => {
    count--;
    const tmp = entries[i];
    entries[i] = entries[count];
    entries[count] = tmp;
    keys[i] = keys[count];
    keys[count] = -1;
  };

  return {
    entries,
    arm(
      key: number,
      kind: number,
      x: number,
      z: number,
      dx: number,
      dz: number,
      radius: number,
      halfArc: number,
      t0: number,
      t1: number,
    ) {
      let i = indexOf(key);
      if (i < 0) {
        if (count >= TELEGRAPH.max) return;
        i = count++;
        keys[i] = key;
      }
      const e = entries[i];
      e.pos[0] = x;
      e.pos[1] = z;
      e.dir[0] = dx;
      e.dir[1] = dz;
      e.radius = radius;
      e.halfArc = halfArc;
      e.t0 = t0;
      e.t1 = t1;
      e.kind = kind;
      e.cosHalf = Math.cos(halfArc);
      e.cosFeatherIn = Math.cos(Math.max(halfArc - TELEGRAPH.arcFeather, 0));
      const reach = kind > 1.5 ? Math.hypot(radius, halfArc) : radius;
      e.boundSq = (reach + GATE) * (reach + GATE);
    },
    move(key: number, x: number, z: number, dx: number, dz: number) {
      const i = indexOf(key);
      if (i < 0) return;
      const e = entries[i];
      e.pos[0] = x;
      e.pos[1] = z;
      e.dir[0] = dx;
      e.dir[1] = dz;
    },
    clear(key: number) {
      const i = indexOf(key);
      if (i >= 0) release(i);
    },
    compact(now: number) {
      for (let i = count - 1; i >= 0; i--) {
        if (now > entries[i].t1 + TELEGRAPH.linger) release(i);
      }
      return count;
    },
  };
}

export type Telegraphs = ReturnType<typeof createTelegraphs>;
