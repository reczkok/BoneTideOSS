import { ARENA_RADIUS } from '../config.ts';
import { normalize2 } from '../core/mathx.ts';

const dirScratch = { x: 0, z: 1 };

export function aimDir(from: { x: number; z: number }, aim: { x: number; z: number }) {
  const dx = aim.x - from.x;
  const dz = aim.z - from.z;
  const [nx, nz, len] = normalize2(dx, dz);
  dirScratch.x = len > 1e-4 ? nx : 0;
  dirScratch.z = len > 1e-4 ? nz : 1;
  return dirScratch;
}

export function clampToArena(p: { x: number; z: number }, margin: number) {
  const r = Math.hypot(p.x, p.z);
  const maxR = ARENA_RADIUS - margin;
  if (r > maxR) {
    p.x *= maxR / r;
    p.z *= maxR / r;
  }
}

const pointScratch = { x: 0, z: 0 };

export function clampCastPoint(
  from: { x: number; z: number },
  aim: { x: number; z: number },
  range: number,
) {
  let tx = aim.x - from.x;
  let tz = aim.z - from.z;
  const td = Math.hypot(tx, tz);
  if (td > range) {
    tx *= range / td;
    tz *= range / td;
  }
  pointScratch.x = from.x + tx;
  pointScratch.z = from.z + tz;
  clampToArena(pointScratch, 1);
  return pointScratch;
}
