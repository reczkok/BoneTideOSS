import { KEYSTONES, PLAYER } from '../../config.ts';
import type { ParticleSpec } from '../../renderer/particles.ts';
import { begin, pcount, pcountEss, pcountRand, rnd, set3, spec } from './pool.ts';

export function arrowHead(x: number, z: number, dx: number, dz: number): ParticleSpec[] {
  const specs = begin();
  const s = spec();
  set3(s.pos, x + dx * 0.5, 1.0, z + dz * 0.5);
  set3(s.vel, dx, 0, dz);
  set3(s.color, 0.9, 2.6, 0.7);
  s.life = 0.08;
  s.size = 0.24;
  s.glow = 1;
  s.shape = 2;
  return specs;
}

export function volleyFlash(x: number, z: number, baseA: number, spread: number): ParticleSpec[] {
  const specs = begin();
  for (let i = 0; i < pcount(16); i++) {
    const a = baseA + rnd(-spread / 2, spread / 2);
    const ax = Math.sin(a);
    const az = Math.cos(a);
    const sp = rnd(6, 14);
    const s = spec();
    set3(s.pos, x + ax * 0.5, rnd(0.8, 1.3), z + az * 0.5);
    set3(s.vel, ax * sp, rnd(-0.5, 1), az * sp);
    set3(s.color, 0.55, 1.5, 0.45);
    s.life = rnd(0.15, 0.35);
    s.size = rnd(0.06, 0.12);
    s.stretch = 2.2;
    s.glow = 1;
  }
  return specs;
}

export function boltHead(
  x: number,
  y: number,
  z: number,
  dx: number,
  dy: number,
  dz: number,
): ParticleSpec[] {
  const specs = begin();
  const s = spec();
  set3(s.pos, x, y, z);
  set3(s.vel, dx * 0.5, dy * 0.5, dz * 0.5);
  set3(s.color, 1.3, 0.4, 2.0);
  s.life = 0.09;
  s.size = 0.3;
  s.glow = 1;
  s.shape = 2;
  return specs;
}

export function boltWake(
  x: number,
  y: number,
  z: number,
  dx: number,
  dy: number,
  dz: number,
): ParticleSpec[] {
  const specs = begin();
  if (pcountRand(1) === 0) return specs;
  const s = spec();
  set3(s.pos, x, y, z);
  set3(s.vel, -dx * 1.5, -dy * 1.5 + 0.3, -dz * 1.5);
  set3(s.color, 0.5, 0.15, 0.8);
  s.life = 0.3;
  s.size = 0.07;
  s.gravity = -0.5;
  s.stretch = 1.2;
  s.glow = 1;
  return specs;
}

export function orbBurst(x: number, z: number, radius: number): ParticleSpec[] {
  const specs = begin();
  const nRing = pcount(14);
  for (let i = 0; i < nRing; i++) {
    const a = (i / nRing) * Math.PI * 2 + rnd(-0.12, 0.12);
    const sp = radius * rnd(3.2, 4.2);
    const s = spec();
    set3(s.pos, x + Math.cos(a) * 0.3, rnd(0.15, 0.5), z + Math.sin(a) * 0.3);
    set3(s.vel, Math.cos(a) * sp, rnd(0.3, 1.2), Math.sin(a) * sp);
    set3(s.color, 1.1, 0.35, 1.9);
    s.life = rnd(0.18, 0.3);
    s.size = rnd(0.08, 0.16);
    s.stretch = 1.6;
    s.glow = 1;
  }
  for (let i = 0; i < pcount(7); i++) {
    const s = spec();
    set3(s.pos, x + rnd(-0.4, 0.4), rnd(0.2, 0.9), z + rnd(-0.4, 0.4));
    set3(s.vel, rnd(-0.6, 0.6), rnd(1.5, 3.5), rnd(-0.6, 0.6));
    set3(s.color, 0.7, 0.25, 1.3);
    s.life = rnd(0.35, 0.6);
    s.size = rnd(0.07, 0.14);
    s.gravity = -1.5;
    s.glow = 1;
  }
  const s = spec();
  set3(s.pos, x, 0.8, z);
  set3(s.vel, 0, 0.5, 0);
  set3(s.color, 2.6, 1.0, 3.8);
  s.life = 0.16;
  s.size = 1.1;
  s.glow = 1;
  s.shape = 2;
  return specs;
}

export function crescentTrail(x: number, z: number, dx: number, dz: number): ParticleSpec[] {
  const specs = begin();
  const [cr, cg, cb] = PLAYER.trailColor;
  const half = KEYSTONES.crescent.halfWidth;
  const speed = KEYSTONES.crescent.speed;
  const lx = -dz;
  const lz = dx;
  const edge = pcountEss(8);
  for (let i = 0; i < edge; i++) {
    const t = ((i + 0.5) / edge) * 2 - 1;
    const arc = 1 - t * t;
    const bulge = arc * 0.55;
    const hot = 0.7 + arc * 0.75;
    const s = spec();
    set3(
      s.pos,
      x + lx * t * half + dx * bulge + rnd(-0.04, 0.04),
      0.55 + arc * 0.4,
      z + lz * t * half + dz * bulge + rnd(-0.04, 0.04),
    );
    set3(s.vel, dx * speed + lx * t * 2.5, 0, dz * speed + lz * t * 2.5);
    set3(s.color, cr * hot, cg * hot, cb * hot);
    s.life = rnd(0.07, 0.11);
    s.size = 0.15 + arc * 0.15;
    s.glow = 1;
  }
  for (let i = 0; i < pcountEss(3); i++) {
    const t = rnd(-0.9, 0.9);
    const back = rnd(0, 0.5);
    const s = spec();
    set3(
      s.pos,
      x + lx * t * half + dx * ((1 - t * t) * 0.55 - back),
      rnd(0.45, 1.0),
      z + lz * t * half + dz * ((1 - t * t) * 0.55 - back),
    );
    set3(s.vel, dx * speed * rnd(0.9, 1.1), rnd(-0.3, 0.3), dz * speed * rnd(0.9, 1.1));
    set3(s.color, cr * 0.8, cg * 0.8, cb * 0.8);
    s.life = rnd(0.1, 0.18);
    s.size = rnd(0.06, 0.12);
    s.stretch = 0.7;
    s.glow = 1;
  }
  for (let i = 0; i < pcountRand(1.6); i++) {
    const t = rnd(-1, 1);
    const s = spec();
    set3(s.pos, x + lx * t * half, rnd(0.3, 0.8), z + lz * t * half);
    set3(
      s.vel,
      dx * rnd(2, 5) + lx * rnd(-1.5, 1.5),
      rnd(0.5, 2.2),
      dz * rnd(2, 5) + lz * rnd(-1.5, 1.5),
    );
    set3(s.color, cr * 0.7, cg * 0.6, cb * 0.45);
    s.life = rnd(0.3, 0.55);
    s.size = rnd(0.05, 0.1);
    s.gravity = 9;
    s.bounce = 0.3;
    s.stretch = 1.3;
    s.glow = 1;
  }
  return specs;
}

export function spearTrail(x: number, z: number, dx: number, dz: number): ParticleSpec[] {
  const specs = begin();
  const [cr, cg, cb] = PLAYER.trailColor;
  const speed = KEYSTONES.crescent.thrust.speed;
  const half = KEYSTONES.crescent.thrust.halfWidth;
  const lx = -dz;
  const lz = dx;
  const head = pcountEss(6);
  for (let i = 0; i < head; i++) {
    const f = i / head;
    const lat = rnd(-half, half) * f;
    const hot = 1.5 - f * 0.7;
    const s = spec();
    set3(
      s.pos,
      x - dx * f * 0.5 + lx * lat + rnd(-0.03, 0.03),
      0.7 + rnd(-0.08, 0.08),
      z - dz * f * 0.5 + lz * lat + rnd(-0.03, 0.03),
    );
    set3(s.vel, dx * speed, 0, dz * speed);
    set3(s.color, cr * hot, cg * hot, cb * hot);
    s.life = rnd(0.07, 0.11);
    s.size = 0.13 + (1 - f) * 0.13;
    s.stretch = 3.0;
    s.glow = 1;
  }
  for (let i = 0; i < pcountEss(3); i++) {
    const lat = rnd(-half, half);
    const back = rnd(0, 0.6);
    const s = spec();
    set3(s.pos, x + lx * lat - dx * back, rnd(0.5, 1.0), z + lz * lat - dz * back);
    set3(s.vel, dx * speed * rnd(0.9, 1.1), rnd(-0.2, 0.2), dz * speed * rnd(0.9, 1.1));
    set3(s.color, cr * 0.8, cg * 0.8, cb * 0.8);
    s.life = rnd(0.1, 0.18);
    s.size = rnd(0.06, 0.11);
    s.stretch = 0.7;
    s.glow = 1;
  }
  for (let i = 0; i < pcountRand(1.2); i++) {
    const lat = rnd(-half, half);
    const s = spec();
    set3(s.pos, x + lx * lat, rnd(0.3, 0.8), z + lz * lat);
    set3(s.vel, dx * rnd(2, 5) + lx * rnd(-1, 1), rnd(0.5, 2.2), dz * rnd(2, 5) + lz * rnd(-1, 1));
    set3(s.color, cr * 0.7, cg * 0.6, cb * 0.45);
    s.life = rnd(0.3, 0.55);
    s.size = rnd(0.05, 0.1);
    s.gravity = 9;
    s.bounce = 0.3;
    s.stretch = 1.3;
    s.glow = 1;
  }
  return specs;
}
