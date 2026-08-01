import { ARENA_RADIUS } from '../../config.ts';
import type { ParticleSpec } from '../../renderer/particles.ts';
import { begin, rnd, set3, spec } from './pool.ts';

export function fallingLeaf(): ParticleSpec[] {
  const specs = begin();
  const a = rnd(0, Math.PI * 2);
  const r = rnd(ARENA_RADIUS - 8, ARENA_RADIUS + 4);
  const drift = rnd(0, Math.PI * 2);
  const green = rnd(0.3, 0.5);
  const s = spec();
  set3(s.pos, Math.cos(a) * r, rnd(3.5, 6.5), Math.sin(a) * r);
  set3(s.vel, Math.cos(drift) * rnd(0.3, 0.9), rnd(-0.2, 0), Math.sin(drift) * rnd(0.3, 0.9));
  set3(s.color, green * rnd(0.9, 1.4), green, rnd(0.1, 0.2));
  s.life = rnd(6, 10);
  s.size = rnd(0.07, 0.12);
  s.gravity = rnd(0.5, 0.9);
  s.stretch = 0.4;
  return specs;
}

export function potionOrb(x: number, y: number, z: number): ParticleSpec[] {
  const specs = begin();
  const s = spec();
  set3(s.pos, x, y, z);
  set3(s.vel, 0, 0, 0);
  set3(s.color, 1.7, 0.28, 0.22);
  s.life = 0.12;
  s.size = 0.32;
  s.glow = 1;
  s.shape = 2;
  return specs;
}

export function potionMote(x: number, y: number, z: number): ParticleSpec[] {
  const specs = begin();
  const s = spec();
  set3(s.pos, x, y, z);
  set3(s.vel, 0, 1.2, 0);
  set3(s.color, 1.5, 0.5, 0.4);
  s.life = 0.6;
  s.size = 0.09;
  s.gravity = -1;
  s.glow = 1;
  s.shape = 1;
  return specs;
}
