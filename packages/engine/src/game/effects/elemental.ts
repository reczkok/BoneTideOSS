import { BUBBLES, FIRE, WATER } from '../../config.ts';
import { lerp } from '../../core/mathx.ts';
import type { ParticleSpec } from '../../renderer/particles.ts';
import { begin, pcount, pcountEss, pcountRand, rnd, set3, spec } from './pool.ts';

export function fireCone(x: number, z: number, dx: number, dz: number): ParticleSpec[] {
  const specs = begin();
  const half = (FIRE.coneHalfAngleDeg * Math.PI) / 180;
  const base = Math.atan2(dx, dz);
  for (let i = 0; i < pcountEss(26); i++) {
    const a = base + rnd(-half, half);
    const ax = Math.sin(a);
    const az = Math.cos(a);
    const sp = rnd(7, 15);
    const s = spec();
    set3(s.pos, x + ax * rnd(0.6, 1.4), rnd(0.3, 1.1), z + az * rnd(0.6, 1.4));
    set3(s.vel, ax * sp, rnd(0.5, 2.5), az * sp);
    set3(s.color, 1.9, rnd(0.5, 1.0), 0.15);
    s.life = rnd(0.3, 0.6);
    s.size = rnd(0.12, 0.26);
    s.gravity = -1.5;
    s.stretch = 1.8;
    s.glow = 1;
  }
  for (let i = 0; i < pcount(8); i++) {
    const a = base + rnd(-half, half);
    const s = spec();
    set3(s.pos, x + Math.sin(a) * rnd(1, 2), rnd(0.4, 1.2), z + Math.cos(a) * rnd(1, 2));
    set3(s.vel, Math.sin(a) * rnd(2, 4), rnd(1.5, 3), Math.cos(a) * rnd(2, 4));
    set3(s.color, 0.35, 0.32, 0.29);
    s.life = rnd(0.7, 1.3);
    s.size = rnd(0.35, 0.6);
    s.gravity = -1;
  }
  return specs;
}

export function spikeRubble(x: number, z: number): ParticleSpec[] {
  const specs = begin();
  for (let i = 0; i < pcount(2); i++) {
    const a = Math.random() * Math.PI * 2;
    const s = spec();
    set3(s.pos, x + rnd(-1.1, 1.1), rnd(0.1, 0.7), z + rnd(-1.1, 1.1));
    set3(s.vel, Math.cos(a) * rnd(0.8, 3), rnd(2, 4.5), Math.sin(a) * rnd(0.8, 3));
    set3(s.color, 0.42, 0.6, 0.9);
    s.life = rnd(0.5, 1.0);
    s.size = rnd(0.25, 0.45);
    s.gravity = 1.2;
  }
  for (let i = 0; i < pcount(5); i++) {
    const a = Math.random() * Math.PI * 2;
    const s = spec();
    set3(s.pos, x + rnd(-1.1, 1.1), rnd(0.3, 1.2), z + rnd(-1.1, 1.1));
    set3(s.vel, Math.cos(a) * rnd(0.5, 2), rnd(1.5, 3.5), Math.sin(a) * rnd(0.5, 2));
    set3(s.color, 0.95, 1.3, 1.85);
    s.life = rnd(0.7, 1.3);
    s.size = rnd(0.04, 0.09);
    s.gravity = 3;
    s.glow = 1;
    s.shape = 1;
  }
  for (let i = 0; i < pcount(6); i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = rnd(2.5, 7);
    const s = spec();
    set3(s.pos, x + rnd(-0.8, 0.8), rnd(0.2, 1.0), z + rnd(-0.8, 0.8));
    set3(s.vel, Math.cos(a) * sp, rnd(5, 11), Math.sin(a) * sp);
    set3(s.color, 0.6, 0.88, 1.35);
    s.life = rnd(0.4, 0.9);
    s.size = rnd(0.09, 0.18);
    s.gravity = 24;
    s.bounce = 0.45;
    s.stretch = 0.5;
  }
  for (let i = 0; i < pcount(5); i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = rnd(2, 5);
    const s = spec();
    set3(s.pos, x + rnd(-0.6, 0.6), rnd(0.2, 0.9), z + rnd(-0.6, 0.6));
    set3(s.vel, Math.cos(a) * sp, rnd(3, 8), Math.sin(a) * sp);
    set3(s.color, 0.8, 1.7, 2.8);
    s.life = rnd(0.25, 0.5);
    s.size = rnd(0.06, 0.12);
    s.gravity = 10;
    s.shape = 1;
    s.glow = 1;
  }
  return specs;
}

export function rockMeltBurst(x: number, z: number): ParticleSpec[] {
  const specs = begin();
  for (let i = 0; i < pcount(3); i++) {
    const a = Math.random() * Math.PI * 2;
    const s = spec();
    set3(s.pos, x + rnd(-0.9, 0.9), rnd(0.2, 1.2), z + rnd(-0.9, 0.9));
    set3(s.vel, Math.cos(a) * rnd(0.3, 0.9), rnd(0.4, 1.0), Math.sin(a) * rnd(0.3, 0.9));
    set3(s.color, 0.55, 0.7, 0.94);
    s.life = rnd(0.8, 1.4);
    s.size = rnd(0.4, 0.6);
    s.gravity = -0.3;
    s.shape = 5;
  }
  for (let i = 0; i < pcount(4); i++) {
    const a = Math.random() * Math.PI * 2;
    const s = spec();
    set3(s.pos, x + rnd(-0.7, 0.7), rnd(0.3, 1.4), z + rnd(-0.7, 0.7));
    set3(s.vel, Math.cos(a) * rnd(0.5, 1.5), rnd(0.5, 2), Math.sin(a) * rnd(0.5, 1.5));
    set3(s.color, 0.8, 1.5, 2.4);
    s.life = rnd(0.3, 0.6);
    s.size = rnd(0.05, 0.1);
    s.gravity = 5;
    s.shape = 1;
    s.glow = 1;
  }
  return specs;
}

export function rockFrostBreath(x: number, z: number): ParticleSpec[] {
  const specs = begin();
  if (pcountRand(1) === 0) return specs;
  for (let i = 0; i < 2; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = rnd(0.5, 1.0);
    const s = spec();
    set3(s.pos, x + Math.cos(a) * r, rnd(0.5, 1.5), z + Math.sin(a) * r);
    set3(s.vel, Math.cos(a) * rnd(0.15, 0.45), -rnd(0.25, 0.5), Math.sin(a) * rnd(0.15, 0.45));
    set3(s.color, 0.6, 0.72, 0.9);
    s.life = rnd(0.9, 1.6);
    s.size = rnd(0.38, 0.6);
    s.gravity = 0.5;
    s.shape = 5;
  }
  if (Math.random() < 0.5) {
    const a = Math.random() * Math.PI * 2;
    const r = rnd(0.8, 1.8);
    const s = spec();
    set3(s.pos, x + Math.cos(a) * r, rnd(0.03, 0.12), z + Math.sin(a) * r);
    set3(s.vel, 0, rnd(0.02, 0.08), 0);
    set3(s.color, 1.1, 1.5, 2.0);
    s.life = rnd(0.2, 0.45);
    s.size = rnd(0.03, 0.06);
    s.glow = 1;
    s.shape = 1;
  }
  return specs;
}

export function rockMeltDrip(x: number, z: number, meltT: number): ParticleSpec[] {
  const specs = begin();
  if (pcountRand(1) === 0) return specs;
  const bodyR = 0.9 * (1 - meltT * 0.5);
  const n = 1 + (Math.random() < 0.4 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = spec();
    set3(
      s.pos,
      x + Math.cos(a) * bodyR,
      rnd(0.3, 1.6) * (1 - meltT * 0.6),
      z + Math.sin(a) * bodyR,
    );
    set3(s.vel, Math.cos(a) * rnd(0.2, 0.6), -rnd(0.2, 0.7), Math.sin(a) * rnd(0.2, 0.6));
    set3(s.color, 0.75, 1.15, 1.7);
    s.life = rnd(0.35, 0.6);
    s.size = rnd(0.035, 0.06);
    s.gravity = 8;
    s.stretch = 1.3;
    s.glow = 1;
  }
  if (Math.random() < 0.3) {
    const a = Math.random() * Math.PI * 2;
    const r = rnd(0.4, 1.1);
    const s = spec();
    set3(s.pos, x + Math.cos(a) * r, 0.04, z + Math.sin(a) * r);
    set3(s.vel, 0, 0.05, 0);
    set3(s.color, 0.7, 1.2, 1.9);
    s.life = rnd(0.25, 0.5);
    s.size = rnd(0.1, 0.18);
    s.glow = 1;
    s.shape = 1;
  }
  return specs;
}

export function frostMist(
  x: number,
  z: number,
  dx: number,
  dz: number,
  frontLen: number,
): ParticleSpec[] {
  const specs = begin();
  const n = pcountEss(Math.min(5, Math.max(1, Math.round(frontLen / 2.5))));
  for (let i = 0; i < n; i++) {
    const along = Math.random() * frontLen;
    const lat = rnd(-1.8, 1.8);
    const s = spec();
    set3(s.pos, x + dx * along + dz * lat, rnd(0.4, 2.0), z + dz * along - dx * lat);
    set3(s.vel, rnd(-0.35, 0.35), rnd(-0.7, -0.25), rnd(-0.35, 0.35));
    set3(s.color, 0.95, 1.3, 1.85);
    s.life = rnd(1.0, 2.0);
    s.size = rnd(0.04, 0.1);
    s.gravity = 0.25;
    s.glow = 1;
    s.shape = 1;
  }
  if (Math.random() < 0.3) {
    const along = Math.random() * frontLen;
    const lat = rnd(-1.4, 1.4);
    const s = spec();
    set3(s.pos, x + dx * along + dz * lat, rnd(0.05, 0.4), z + dz * along - dx * lat);
    set3(s.vel, rnd(-0.3, 0.3), rnd(0.08, 0.25), rnd(-0.3, 0.3));
    set3(s.color, 0.5, 0.64, 0.88);
    s.life = rnd(0.8, 1.4);
    s.size = rnd(0.35, 0.55);
    s.gravity = -0.2;
    s.shape = 5;
  }
  return specs;
}

export function delugeBurst(x: number, z: number, dx: number, dz: number): ParticleSpec[] {
  const specs = begin();
  const half = (WATER.coneHalfAngleDeg * Math.PI) / 180;
  const base = Math.atan2(dx, dz);
  for (let i = 0; i < pcount(34); i++) {
    const a = base + rnd(-half, half);
    const ax = Math.sin(a);
    const az = Math.cos(a);
    const sp = rnd(7, 15);
    const s = spec();
    set3(s.pos, x + ax * rnd(0.6, 1.6), rnd(0.3, 1.8), z + az * rnd(0.6, 1.6));
    set3(s.vel, ax * sp, rnd(3, 7.5), az * sp);
    set3(s.color, 0.85, 1.15, 1.5);
    s.life = rnd(0.4, 0.85);
    s.size = rnd(0.08, 0.2);
    s.gravity = 11;
    s.bounce = 0.2;
    s.stretch = 1.6;
    s.glow = 1;
  }
  for (let i = 0; i < pcount(12); i++) {
    const a = base + rnd(-half * 0.8, half * 0.8);
    const ax = Math.sin(a);
    const az = Math.cos(a);
    const s = spec();
    set3(s.pos, x + ax * rnd(1.0, 2.0), rnd(1.2, 2.2), z + az * rnd(1.0, 2.0));
    set3(s.vel, ax * rnd(5, 9), rnd(1.5, 4), az * rnd(5, 9));
    set3(s.color, 0.95, 1.05, 1.15);
    s.life = rnd(0.5, 0.9);
    s.size = rnd(0.25, 0.45);
    s.gravity = 9;
    s.bounce = 0.35;
    s.glow = 1;
  }
  for (let i = 0; i < pcount(12); i++) {
    const a = base + rnd(-half, half);
    const s = spec();
    set3(s.pos, x + Math.sin(a) * rnd(1, 2.4), rnd(0.15, 0.6), z + Math.cos(a) * rnd(1, 2.4));
    set3(s.vel, Math.sin(a) * rnd(2.5, 5.5), rnd(0.4, 1.2), Math.cos(a) * rnd(2.5, 5.5));
    set3(s.color, 0.55, 0.66, 0.74);
    s.life = rnd(0.8, 1.5);
    s.size = rnd(0.4, 0.75);
    s.gravity = -0.4;
  }
  return specs;
}

export function delugeFront(
  x: number,
  z: number,
  dx: number,
  dz: number,
  front: number,
): ParticleSpec[] {
  const specs = begin();
  const half = (WATER.coneHalfAngleDeg * Math.PI) / 180;
  const base = Math.atan2(dx, dz);
  for (let i = 0; i < pcountEss(7); i++) {
    const a = base + rnd(-half * 0.92, half * 0.92);
    const ax = Math.sin(a);
    const az = Math.cos(a);
    const s = spec();
    set3(s.pos, x + ax * front, rnd(0.15, 0.7), z + az * front);
    set3(s.vel, ax * rnd(4, 8), rnd(2, 4.5), az * rnd(4, 8));
    set3(s.color, 0.9, 1.1, 1.35);
    s.life = rnd(0.25, 0.5);
    s.size = rnd(0.08, 0.18);
    s.gravity = 10;
    s.bounce = 0.2;
    s.stretch = 1.4;
    s.glow = 1;
  }
  for (let i = 0; i < pcountEss(2); i++) {
    const a = base + rnd(-half, half);
    const s = spec();
    set3(s.pos, x + Math.sin(a) * front, rnd(0.1, 0.4), z + Math.cos(a) * front);
    set3(s.vel, Math.sin(a) * rnd(2, 4), rnd(0.5, 1.2), Math.cos(a) * rnd(2, 4));
    set3(s.color, 0.6, 0.7, 0.78);
    s.life = rnd(0.6, 1.1);
    s.size = rnd(0.3, 0.55);
    s.gravity = -0.5;
  }
  return specs;
}

export function wakeBubbles(ox: number, oz: number, tx: number, tz: number): ParticleSpec[] {
  const specs = begin();
  if (pcountRand(1) === 0) return specs;
  const f = Math.random();
  const x = lerp(ox, tx, f);
  const z = lerp(oz, tz, f);
  const a = rnd(0, Math.PI * 2);
  const r = rnd(0, 0.6);
  const bx = x + Math.cos(a) * r;
  const bz = z + Math.sin(a) * r;
  const gulp = Math.random() < BUBBLES.gulpChance;
  const s = spec();
  set3(s.pos, bx, rnd(0.04, 0.14), bz);
  set3(s.vel, 0, gulp ? rnd(0.14, 0.28) : rnd(0.3, 0.6), 0);
  set3(s.color, 0.5, 1.6, 0.35);
  s.life = gulp ? rnd(0.9, 1.4) : rnd(0.4, 0.85);
  s.size = gulp ? rnd(0.15, 0.22) : rnd(0.05, 0.11);
  s.gravity = gulp ? -0.25 : -0.6;
  s.shape = 3;
  if (Math.random() < BUBBLES.popChance) {
    const px = x + Math.cos(a + 1.7) * r;
    const pz = z + Math.sin(a + 1.7) * r;
    const ring = spec();
    set3(ring.pos, px, rnd(0.06, 0.12), pz);
    set3(ring.vel, 0, 0.15, 0);
    set3(ring.color, 0.7, 2.2, 0.5);
    ring.life = rnd(0.22, 0.34);
    ring.size = rnd(0.16, 0.24);
    ring.glow = 1;
    ring.shape = 4;
    for (let i = 0; i < BUBBLES.popDroplets; i++) {
      const da = rnd(0, Math.PI * 2);
      const sp = rnd(0.5, 1.6);
      const dr = spec();
      set3(dr.pos, px, rnd(0.08, 0.16), pz);
      set3(dr.vel, Math.cos(da) * sp, rnd(1.2, 2.6), Math.sin(da) * sp);
      set3(dr.color, 0.6, 1.9, 0.45);
      dr.life = rnd(0.25, 0.45);
      dr.size = rnd(0.025, 0.05);
      dr.gravity = 9;
      dr.stretch = 1.1;
      dr.glow = 1;
    }
  }
  return specs;
}
