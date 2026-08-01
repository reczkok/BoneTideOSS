import type { ParticleSpec } from '../../renderer/particles.ts';
import { begin, pcount, pcountEss, rnd, set3, spec } from './pool.ts';

export function spawnDirt(x: number, z: number): ParticleSpec[] {
  const specs = begin();
  for (let i = 0; i < pcount(9); i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = rnd(0.8, 2.6);
    const s = spec();
    set3(s.pos, x + rnd(-0.3, 0.3), 0.05, z + rnd(-0.3, 0.3));
    set3(s.vel, Math.cos(a) * sp, rnd(1.5, 4.5), Math.sin(a) * sp);
    if (i % 3 === 0) set3(s.color, 0.32, 0.42, 0.2);
    else set3(s.color, 0.42, 0.34, 0.22);
    s.life = rnd(0.5, 1.0);
    s.size = rnd(0.12, 0.3);
    s.gravity = 14;
  }
  return specs;
}

export function stompDust(x: number, z: number, r: number): ParticleSpec[] {
  const specs = begin();
  for (let i = 0; i < pcount(5); i++) {
    const a = Math.random() * Math.PI * 2;
    const rr = r * rnd(0.5, 1.1);
    const s = spec();
    set3(s.pos, x + Math.cos(a) * rr, 0.08, z + Math.sin(a) * rr);
    set3(s.vel, Math.cos(a) * rnd(0.8, 2), rnd(0.5, 1.6), Math.sin(a) * rnd(0.8, 2));
    set3(s.color, 0.4, 0.34, 0.24);
    s.life = rnd(0.4, 0.8);
    s.size = rnd(0.25, 0.5);
    s.gravity = 2;
  }
  return specs;
}

export function slamTelegraph(x: number, z: number, radius: number): ParticleSpec[] {
  const specs = begin();
  for (let i = 0; i < pcountEss(3); i++) {
    const a = Math.random() * Math.PI * 2;
    const rr = radius * Math.sqrt(Math.random()) * 0.9;
    const s = spec();
    set3(s.pos, x + Math.cos(a) * rr, 0.04, z + Math.sin(a) * rr);
    set3(s.vel, rnd(-0.3, 0.3), rnd(1.2, 2.6), rnd(-0.3, 0.3));
    set3(s.color, 0.45, 0.38, 0.26);
    s.life = rnd(0.3, 0.55);
    s.size = rnd(0.08, 0.2);
    s.gravity = -1.5;
  }
  const a = Math.random() * Math.PI * 2;
  const s = spec();
  set3(s.pos, x + Math.cos(a) * radius, 0.15, z + Math.sin(a) * radius);
  set3(s.vel, 0, rnd(0.4, 1), 0);
  set3(s.color, 2.2, 0.7, 0.2);
  s.life = rnd(0.25, 0.45);
  s.size = rnd(0.1, 0.18);
  s.glow = 1;
  return specs;
}

export function slamImpact(x: number, z: number, radius: number): ParticleSpec[] {
  const specs = begin();
  const nDust = pcount(22);
  for (let i = 0; i < nDust; i++) {
    const a = (i / nDust) * Math.PI * 2 + rnd(-0.1, 0.1);
    const sp = rnd(6, 11);
    const s = spec();
    set3(s.pos, x + Math.cos(a) * 0.8, rnd(0.1, 0.5), z + Math.sin(a) * 0.8);
    set3(s.vel, Math.cos(a) * sp, rnd(0.5, 2), Math.sin(a) * sp);
    set3(s.color, 0.5, 0.42, 0.3);
    s.life = rnd(0.4, 0.75) * (radius / 6);
    s.size = rnd(0.3, 0.6);
    s.gravity = 6;
    s.stretch = 1.2;
  }
  for (let i = 0; i < pcount(10); i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = rnd(2, 6);
    const s = spec();
    set3(s.pos, x + rnd(-0.5, 0.5), rnd(0.2, 0.8), z + rnd(-0.5, 0.5));
    set3(s.vel, Math.cos(a) * sp, rnd(4, 9), Math.sin(a) * sp);
    set3(s.color, 0.35, 0.31, 0.26);
    s.life = rnd(0.6, 1.1);
    s.size = rnd(0.12, 0.26);
    s.gravity = 16;
    s.bounce = 0.3;
  }
  for (let i = 0; i < pcount(8); i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = rnd(3, 7);
    const s = spec();
    set3(s.pos, x, rnd(0.2, 0.6), z);
    set3(s.vel, Math.cos(a) * sp, rnd(3, 7), Math.sin(a) * sp);
    set3(s.color, 2.4, 0.8, 0.2);
    s.life = rnd(0.35, 0.7);
    s.size = rnd(0.08, 0.16);
    s.gravity = 10;
    s.glow = 1;
    s.stretch = 1.5;
  }
  const s = spec();
  set3(s.pos, x, 0.7, z);
  set3(s.vel, 0, 0.5, 0);
  set3(s.color, 3.2, 1.6, 0.6);
  s.life = 0.18;
  s.size = 1.6;
  s.glow = 1;
  s.shape = 2;
  return specs;
}

export function boulderTrail(
  x: number,
  y: number,
  z: number,
  dx: number,
  dz: number,
): ParticleSpec[] {
  const specs = begin();
  const s = spec();
  set3(s.pos, x + rnd(-0.2, 0.2), y - 0.2, z + rnd(-0.2, 0.2));
  set3(s.vel, -dx * 0.3 + rnd(-0.5, 0.5), rnd(-0.8, 0.2), -dz * 0.3 + rnd(-0.5, 0.5));
  set3(s.color, 0.42, 0.36, 0.27);
  s.life = rnd(0.25, 0.45);
  s.size = rnd(0.12, 0.22);
  s.gravity = 3;
  if (Math.random() < 0.3) {
    const f = spec();
    set3(f.pos, x, y, z);
    set3(f.vel, -dx * 0.2, rnd(-0.5, 0.5), -dz * 0.2);
    set3(f.color, 2.0, 0.6, 0.18);
    f.life = rnd(0.15, 0.3);
    f.size = rnd(0.06, 0.11);
    f.glow = 1;
  }
  return specs;
}

export function boneBurst(x: number, z: number): ParticleSpec[] {
  const specs = begin();
  for (let i = 0; i < pcount(9); i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = rnd(2, 5.5);
    const s = spec();
    set3(s.pos, x + rnd(-0.3, 0.3), rnd(0.4, 1.1), z + rnd(-0.3, 0.3));
    set3(s.vel, Math.cos(a) * sp, rnd(2.5, 6), Math.sin(a) * sp);
    set3(s.color, 0.8, 0.77, 0.66);
    s.life = rnd(0.5, 0.9);
    s.size = rnd(0.1, 0.22);
    s.gravity = 15;
    s.bounce = 0.25;
  }
  for (let i = 0; i < pcount(6); i++) {
    const s = spec();
    set3(s.pos, x + rnd(-0.5, 0.5), rnd(0.3, 1.0), z + rnd(-0.5, 0.5));
    set3(s.vel, rnd(-1, 1), rnd(0.8, 2), rnd(-1, 1));
    set3(s.color, 0.42, 0.95, 0.28);
    s.life = rnd(0.6, 1.0);
    s.size = rnd(0.35, 0.55);
    s.gravity = -0.5;
    s.shape = 5;
  }
  return specs;
}

export function summonRaise(x: number, z: number): ParticleSpec[] {
  const specs = begin();
  for (let i = 0; i < pcountEss(14); i++) {
    const a = Math.random() * Math.PI * 2;
    const rr = rnd(0.3, 1.0);
    const s = spec();
    set3(s.pos, x + Math.cos(a) * rr, rnd(0.1, 0.7), z + Math.sin(a) * rr);
    set3(s.vel, rnd(-0.4, 0.4), rnd(2.2, 4.5), rnd(-0.4, 0.4));
    set3(s.color, 1.4, 0.85, 2.6);
    s.life = rnd(0.5, 0.9);
    s.size = rnd(0.08, 0.16);
    s.gravity = -2;
    s.glow = 1;
    s.stretch = 1.2;
  }
  const nRing = pcountEss(12);
  for (let i = 0; i < nRing; i++) {
    const a = (i / nRing) * Math.PI * 2 + rnd(-0.15, 0.15);
    const s = spec();
    set3(s.pos, x + Math.cos(a) * 1.2, 0.04, z + Math.sin(a) * 1.2);
    set3(s.vel, Math.cos(a) * rnd(0.6, 1.4), rnd(0.2, 0.6), Math.sin(a) * rnd(0.6, 1.4));
    set3(s.color, 0.9, 0.5, 1.8);
    s.life = rnd(0.4, 0.7);
    s.size = rnd(0.1, 0.2);
    s.glow = 1;
  }
  const s = spec();
  set3(s.pos, x, 1.3, z);
  set3(s.vel, 0, 1, 0);
  set3(s.color, 2.4, 1.4, 3.6);
  s.life = 0.22;
  s.size = 1.1;
  s.glow = 1;
  s.shape = 2;
  return specs;
}
