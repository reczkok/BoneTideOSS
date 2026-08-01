import { PARTICLE_DENSITY } from '../../config.ts';
import type { ParticleSpec } from '../../renderer/particles.ts';

export { rnd } from '../../core/mathx.ts';

let density = PARTICLE_DENSITY.tiers.normal as number;

export function setEffectDensity(value: number) {
  density = value;
}

export const pcount = (n: number) => Math.max(1, Math.round(n * density));
export const pcountEss = (n: number) =>
  Math.max(1, Math.round(n * Math.max(density, PARTICLE_DENSITY.essentialFloor)));
export const pcountRand = (n: number) => {
  const x = n * density;
  const f = Math.floor(x);
  return f + (Math.random() < x - f ? 1 : 0);
};

export type Vec3 = [number, number, number];

const makeSpec = () => {
  const result: Required<ParticleSpec> = {
    pos: [0, 0, 0],
    vel: [0, 0, 0],
    color: [0, 0, 0],
    life: 0,
    size: 0,
    gravity: 0,
    bounce: 0,
    stretch: 0,
    glow: 0,
    home: 0,
    shape: 0,
  };
  return result;
};
const pool: Required<ParticleSpec>[] = Array.from({ length: 64 }, makeSpec);
const batch: ParticleSpec[] = [];

export function begin(): ParticleSpec[] {
  batch.length = 0;
  return batch;
}

export function spec(): Required<ParticleSpec> {
  let s = pool[batch.length];
  if (!s) {
    s = makeSpec();
    pool.push(s);
  }
  s.life = 0;
  s.size = 0;
  s.gravity = 0;
  s.bounce = 0;
  s.stretch = 0;
  s.glow = 0;
  s.home = 0;
  s.shape = 0;
  batch.push(s);
  return s;
}

export const set3 = (v: Vec3, x: number, y: number, z: number) => {
  v[0] = x;
  v[1] = y;
  v[2] = z;
};
