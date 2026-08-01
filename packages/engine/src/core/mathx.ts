export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export const saturate = (x: number) => clamp(x, 0, 1);

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function smooth01(e0: number, e1: number, x: number) {
  const t = saturate((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

export const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

const normalized2: [number, number, number] = [0, 0, 0];

/** Returns `[nx, nz, length]` in shared scratch storage overwritten by the next call. */
export function normalize2(x: number, z: number): [number, number, number] {
  const len = Math.hypot(x, z);
  if (len > 0) {
    normalized2[0] = x / len;
    normalized2[1] = z / len;
  } else {
    normalized2[0] = 0;
    normalized2[1] = 0;
  }
  normalized2[2] = len;
  return normalized2;
}
