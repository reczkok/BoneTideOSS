import { KEYSTONES, PLAYER, SHOCK, WELL } from '../../config.ts';
import type { ParticleSpec } from '../../renderer/particles.ts';
import { begin, pcount, pcountEss, pcountRand, rnd, set3, spec } from './pool.ts';

export function swingSparks(
  x: number,
  z: number,
  aimX: number,
  aimZ: number,
  arcDeg: number,
  f0: number,
  f1: number,
  sign: number,
): ParticleSpec[] {
  const specs = begin();
  const base = Math.atan2(aimX, aimZ);
  const half = (arcDeg * Math.PI) / 360;
  const count = pcount(10 * (f1 - f0));
  for (let i = 0; i < count; i++) {
    const f = f0 + ((i + 0.5) / count) * (f1 - f0);
    const a = base + sign * (-half + f * half * 2);
    const sx = Math.sin(a);
    const sz = Math.cos(a);
    const tx = Math.cos(a) * sign;
    const tz = -Math.sin(a) * sign;
    const r = PLAYER.sparkRadius + rnd(-0.18, 0.28);
    const edge = rnd(-0.16, 0.16);
    const s = spec();
    set3(
      s.pos,
      x + sx * r + tx * edge,
      PLAYER.sparkHeight + rnd(-0.1, 0.16),
      z + sz * r + tz * edge,
    );
    set3(
      s.vel,
      sx * rnd(0.5, 1.8) + tx * rnd(5, 10),
      rnd(0.1, 1.4),
      sz * rnd(0.5, 1.8) + tz * rnd(5, 10),
    );
    set3(s.color, 1.7, 1.45, 0.8);
    s.life = rnd(0.12, 0.22);
    s.size = rnd(0.07, 0.15);
    s.gravity = 1.4;
    s.stretch = 2.2;
    s.glow = 1;
  }
  return specs;
}

export function stabSparks(
  x: number,
  z: number,
  aimX: number,
  aimZ: number,
  f0: number,
  f1: number,
): ParticleSpec[] {
  const specs = begin();
  const count = pcount(10 * (f1 - f0));
  for (let i = 0; i < count; i++) {
    const f = f0 + ((i + 0.5) / count) * (f1 - f0);
    const ext = 1 - (1 - f) * (1 - f);
    const along = 0.5 + ext * PLAYER.stabReach;
    const lat = rnd(-0.16, 0.16);
    const s = spec();
    set3(
      s.pos,
      x + aimX * along + aimZ * lat,
      PLAYER.sparkHeight + rnd(-0.08, 0.14),
      z + aimZ * along - aimX * lat,
    );
    set3(
      s.vel,
      aimX * rnd(8, 14) + rnd(-0.6, 0.6),
      rnd(0.1, 1.2),
      aimZ * rnd(8, 14) + rnd(-0.6, 0.6),
    );
    set3(s.color, 1.7, 1.45, 0.8);
    s.life = rnd(0.1, 0.2);
    s.size = rnd(0.07, 0.15);
    s.gravity = 1.4;
    s.stretch = 2.6;
    s.glow = 1;
  }
  return specs;
}

export function novaFlash(x: number, z: number): ParticleSpec[] {
  const specs = begin();
  const nRing = pcount(40);
  for (let i = 0; i < nRing; i++) {
    const a = (i / nRing) * Math.PI * 2;
    const dirX = Math.cos(a);
    const dirZ = Math.sin(a);
    const s = spec();
    set3(s.pos, x + dirX * 0.6, rnd(0.2, 1.4), z + dirZ * 0.6);
    set3(s.vel, dirX * rnd(10, SHOCK.speed + 4), rnd(0.5, 2.5), dirZ * rnd(10, SHOCK.speed + 4));
    set3(s.color, 1.9, 1.3, 0.5);
    s.life = rnd(0.35, 0.7);
    s.size = rnd(0.08, 0.16);
    s.gravity = 1;
    s.stretch = 1.6;
    s.glow = 1;
  }
  for (let i = 0; i < pcount(14); i++) {
    const s = spec();
    set3(s.pos, x + rnd(-0.25, 0.25), rnd(0.1, 0.6), z + rnd(-0.25, 0.25));
    set3(s.vel, rnd(-0.5, 0.5), rnd(7, 14), rnd(-0.5, 0.5));
    set3(s.color, 1.6, 1.2, 0.55);
    s.life = rnd(0.3, 0.55);
    s.size = rnd(0.1, 0.2);
    s.gravity = 4;
    s.stretch = 2.2;
    s.glow = 1;
  }
  return specs;
}

export function levelUpBurst(x: number, z: number, mult = 1): ParticleSpec[] {
  const specs = begin();
  for (let i = 0; i < 3; i++) {
    const s = spec();
    set3(s.pos, x, 0.4 + i * 0.5, z);
    set3(s.vel, 0, 2.2, 0);
    set3(s.color, 2.6, 2.0, 0.8);
    s.life = 0.3 + i * 0.08;
    s.size = rnd(0.8, 1.1);
    s.glow = 1;
    s.shape = 4;
  }
  const nRing = pcount(36 * mult);
  for (let i = 0; i < nRing; i++) {
    const a = (i / nRing) * Math.PI * 2;
    const dirX = Math.cos(a);
    const dirZ = Math.sin(a);
    const s = spec();
    set3(s.pos, x + dirX * 0.5, rnd(0.08, 0.25), z + dirZ * 0.5);
    set3(s.vel, dirX * rnd(10, 16), rnd(0.2, 0.9), dirZ * rnd(10, 16));
    set3(s.color, 2.3, 1.75, 0.6);
    s.life = rnd(0.4, 0.7);
    s.size = rnd(0.1, 0.18);
    s.gravity = 2;
    s.stretch = 2.4;
    s.glow = 1;
  }
  for (let i = 0; i < pcount(12 * mult); i++) {
    const a = Math.random() * Math.PI * 2;
    const r = rnd(0.1, 0.45);
    const s = spec();
    set3(s.pos, x + Math.cos(a) * r, rnd(0.1, 0.8), z + Math.sin(a) * r);
    set3(s.vel, 0, rnd(9, 16), 0);
    set3(s.color, 2.8, 2.2, 0.9);
    s.life = rnd(0.25, 0.45);
    s.size = rnd(0.1, 0.18);
    s.gravity = -4;
    s.stretch = 3.2;
    s.glow = 1;
  }
  for (let i = 0; i < pcount(30 * mult); i++) {
    const a = Math.random() * Math.PI * 2;
    const r = rnd(0.3, 1.0);
    const s = spec();
    set3(s.pos, x + Math.cos(a) * r, rnd(0.1, 1.8), z + Math.sin(a) * r);
    set3(s.vel, Math.cos(a) * rnd(-0.2, 0.4), rnd(3, 7), Math.sin(a) * rnd(-0.2, 0.4));
    set3(s.color, 2.4, 1.85, 0.7);
    s.life = rnd(0.6, 1.2);
    s.size = rnd(0.06, 0.14);
    s.gravity = -3;
    s.shape = 1;
    s.glow = 1;
  }
  for (let i = 0; i < pcount(18 * mult); i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = rnd(1.5, 4.5);
    const s = spec();
    set3(s.pos, x + rnd(-0.3, 0.3), rnd(0.4, 1.2), z + rnd(-0.3, 0.3));
    set3(s.vel, Math.cos(a) * sp, rnd(5, 10), Math.sin(a) * sp);
    set3(s.color, 2.2, 1.5, 0.45);
    s.life = rnd(0.7, 1.3);
    s.size = rnd(0.06, 0.12);
    s.gravity = 12;
    s.bounce = 0.4;
    s.stretch = 1.4;
    s.glow = 1;
  }
  for (let i = 0; i < 4; i++) {
    const s = spec();
    set3(s.pos, x, 0.5 + i * 0.65, z);
    set3(s.vel, 0, 2.5, 0);
    set3(s.color, 2.8, 2.2, 0.95);
    s.life = 0.28;
    s.size = rnd(0.6, 0.85);
    s.glow = 1;
    s.shape = 2;
  }
  return specs;
}

export function dashDust(x: number, z: number, dirX: number, dirZ: number): ParticleSpec[] {
  const specs = begin();
  for (let i = 0; i < pcount(7); i++) {
    const s = spec();
    set3(s.pos, x + rnd(-0.3, 0.3), rnd(0.05, 0.3), z + rnd(-0.3, 0.3));
    set3(
      s.vel,
      -dirX * rnd(0.5, 2) + rnd(-0.6, 0.6),
      rnd(0.4, 1.4),
      -dirZ * rnd(0.5, 2) + rnd(-0.6, 0.6),
    );
    set3(s.color, 0.55, 0.52, 0.42);
    s.life = rnd(0.35, 0.7);
    s.size = rnd(0.2, 0.4);
    s.gravity = 0.5;
  }
  return specs;
}

export function mendBurst(x: number, z: number): ParticleSpec[] {
  const specs = begin();
  for (let i = 0; i < pcount(10); i++) {
    const a = Math.random() * Math.PI * 2;
    const s = spec();
    set3(s.pos, x, 0.6, z);
    set3(s.vel, Math.cos(a) * 2, rnd(2.5, 4.5), Math.sin(a) * 2);
    set3(s.color, 0.5, 1.6, 0.6);
    s.life = rnd(0.35, 0.65);
    s.size = 0.09;
    s.gravity = -1;
    s.stretch = 0.5;
    s.glow = 1;
  }
  return specs;
}

export function wellCore(x: number, z: number, ramp: number, scale = 1): ParticleSpec[] {
  const specs = begin();
  const core = spec();
  set3(core.pos, x, 1.1, z);
  set3(core.vel, 0, 0, 0);
  set3(core.color, 0.05, 0.01, 0.09);
  core.life = 0.09;
  core.size = 0.85 * ramp * scale;
  const halo = spec();
  set3(halo.pos, x, 1.1, z);
  set3(halo.vel, 0, 0, 0);
  set3(halo.color, 1.1, 0.45, 2.1);
  halo.life = 0.09;
  halo.size = 0.6 * ramp * scale;
  halo.glow = 1;
  halo.shape = 2;
  return specs;
}

export function wellAccretion(x: number, z: number, mult = 1, radiusBonus = 0): ParticleSpec[] {
  const specs = begin();
  const rim = WELL.radius + radiusBonus;
  for (let i = 0; i < pcountRand(3 * mult); i++) {
    const a = Math.random() * Math.PI * 2;
    const r = rnd(rim * 0.35, rim * 0.85);
    const tx = -Math.sin(a);
    const tz = Math.cos(a);
    const sp = rnd(3, 6) * (mult > 1 ? 1.35 : 1);
    const s = spec();
    set3(s.pos, x + Math.cos(a) * r, rnd(0.3, 1.8), z + Math.sin(a) * r);
    set3(s.vel, tx * sp, rnd(-0.3, 0.5), tz * sp);
    if (i % 2 === 0) set3(s.color, 1.0, 0.5, 2.0);
    else set3(s.color, 0.5, 0.8, 1.8);
    s.life = rnd(0.6, 1.2);
    s.size = rnd(0.06, 0.12);
    s.stretch = 2.6;
    s.glow = 1;
  }
  return specs;
}

export function singularityInfall(x: number, z: number, count: number): ParticleSpec[] {
  const specs = begin();
  const rim = WELL.radius + KEYSTONES.singularity.radiusBonus;
  for (let i = 0; i < pcount(count); i++) {
    const a = Math.random() * Math.PI * 2;
    const r = rnd(rim * 0.75, rim * 1.05);
    const dirX = -Math.cos(a);
    const dirZ = -Math.sin(a);
    const sp = rnd(10, 16);
    const s = spec();
    set3(s.pos, x + Math.cos(a) * r, rnd(0.4, 2.2), z + Math.sin(a) * r);
    set3(s.vel, dirX * sp, rnd(-0.3, 0.3), dirZ * sp);
    if (i % 3 === 0) set3(s.color, 1.6, 1.3, 2.6);
    else set3(s.color, 1.2, 0.5, 2.4);
    s.life = rnd(0.3, 0.5);
    s.size = rnd(0.06, 0.12);
    s.stretch = 3.2;
    s.glow = 1;
  }
  return specs;
}

export function wellBurst(x: number, z: number, scale = 1): ParticleSpec[] {
  const specs = begin();
  const n = pcount(36 * scale);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const dirX = Math.cos(a);
    const dirZ = Math.sin(a);
    const sp = rnd(9, 18) * scale;
    const s = spec();
    set3(s.pos, x + dirX * 0.4, rnd(0.3, 1.6), z + dirZ * 0.4);
    set3(s.vel, dirX * sp, rnd(1, 5), dirZ * sp);
    if (i % 3 === 0) set3(s.color, 0.6, 0.9, 2.0);
    else set3(s.color, 1.4, 0.55, 2.4);
    s.life = rnd(0.35, 0.7);
    s.size = rnd(0.08, 0.16);
    s.gravity = 2;
    s.stretch = 1.8;
    s.glow = 1;
  }
  for (let i = 0; i < pcount(10 * scale); i++) {
    const s = spec();
    set3(s.pos, x + rnd(-0.2, 0.2), rnd(0.2, 0.8), z + rnd(-0.2, 0.2));
    set3(s.vel, rnd(-0.4, 0.4), rnd(8, 15) * scale, rnd(-0.4, 0.4));
    set3(s.color, 1.2, 0.7, 2.2);
    s.life = rnd(0.3, 0.5);
    s.size = rnd(0.1, 0.2);
    s.gravity = 4;
    s.stretch = 2.4;
    s.glow = 1;
  }
  if (scale > 1) {
    const nRing = pcount(24);
    for (let i = 0; i < nRing; i++) {
      const a = (i / nRing) * Math.PI * 2;
      const dirX = Math.cos(a);
      const dirZ = Math.sin(a);
      const s = spec();
      set3(s.pos, x + dirX * 1.2, rnd(0.1, 0.35), z + dirZ * 1.2);
      set3(s.vel, dirX * rnd(16, 22), rnd(0.2, 0.8), dirZ * rnd(16, 22));
      set3(s.color, 0.9, 0.6, 1.8);
      s.life = rnd(0.3, 0.55);
      s.size = rnd(0.12, 0.2);
      s.stretch = 2.8;
      s.glow = 1;
    }
  }
  return specs;
}

export function meteorTelegraph(x: number, z: number): ParticleSpec[] {
  const specs = begin();
  for (let i = 0; i < pcountEss(2); i++) {
    const a = Math.random() * Math.PI * 2;
    const r = rnd(0.3, 1.4);
    const s = spec();
    set3(s.pos, x + Math.cos(a) * r, rnd(0.05, 0.3), z + Math.sin(a) * r);
    set3(s.vel, 0, rnd(2.5, 5), 0);
    set3(s.color, 1.8, 0.7, 0.15);
    s.life = rnd(0.2, 0.4);
    s.size = rnd(0.05, 0.1);
    s.stretch = 1.8;
    s.glow = 1;
  }
  return specs;
}

export function meteorTrail(x: number, y: number, z: number, scale = 1): ParticleSpec[] {
  const specs = begin();
  const n = Math.max(2, pcountEss(6 * scale));
  for (let i = 0; i < n; i++) {
    const s = spec();
    set3(s.pos, x + rnd(-0.5, 0.5) * scale, y + rnd(-0.3, 0.7) * scale, z + rnd(-0.5, 0.5) * scale);
    set3(s.vel, rnd(3, 8), rnd(2, 6), rnd(-4, -1));
    set3(s.color, 1.8, rnd(0.55, 1.05), 0.22);
    s.life = rnd(0.25, 0.5);
    s.size = rnd(0.16, 0.34) * scale;
    s.gravity = -2;
    s.stretch = 1.4;
    s.glow = 1;
  }
  const smoke = spec();
  set3(smoke.pos, x, y + 0.5, z);
  set3(smoke.vel, rnd(1, 3), rnd(1, 2.5), rnd(-1.5, 0.5));
  set3(smoke.color, 0.35, 0.33, 0.3);
  smoke.life = rnd(0.6, 1.1);
  smoke.size = rnd(0.4, 0.7) * scale;
  smoke.gravity = -1;
  return specs;
}

export function meteorImpact(x: number, z: number, scale = 1): ParticleSpec[] {
  const specs = begin();
  for (let i = 0; i < pcountEss(26 * scale); i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = rnd(4, 14) * scale;
    const s = spec();
    set3(s.pos, x + rnd(-0.5, 0.5) * scale, rnd(0.2, 1.2), z + rnd(-0.5, 0.5) * scale);
    set3(s.vel, Math.cos(a) * sp, rnd(2, 9), Math.sin(a) * sp);
    set3(s.color, 1.9, rnd(0.5, 1.0), 0.2);
    s.life = rnd(0.3, 0.8);
    s.size = rnd(0.08, 0.18);
    s.gravity = 12;
    s.bounce = 0.3;
    s.stretch = 1.5;
    s.glow = 1;
  }
  for (let i = 0; i < pcountEss(14 * scale); i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = rnd(3, 9) * scale;
    const s = spec();
    set3(s.pos, x, rnd(0.3, 1.0), z);
    set3(s.vel, Math.cos(a) * sp, rnd(4, 10), Math.sin(a) * sp);
    set3(s.color, 0.45, 0.4, 0.34);
    s.life = rnd(0.8, 1.6);
    s.size = rnd(0.1, 0.22);
    s.gravity = 26;
    s.bounce = 0.4;
    s.stretch = 0.3;
  }
  for (let i = 0; i < pcountEss(14 * scale); i++) {
    const a = Math.random() * Math.PI * 2;
    const s = spec();
    set3(s.pos, x + rnd(-1, 1) * scale, rnd(0.2, 1.5), z + rnd(-1, 1) * scale);
    set3(s.vel, Math.cos(a) * rnd(1, 3.5), rnd(1.5, 4), Math.sin(a) * rnd(1, 3.5));
    set3(s.color, 0.3, 0.28, 0.26);
    s.life = rnd(0.9, 1.8);
    s.size = rnd(0.45, 0.85) * scale;
    s.gravity = -1.2;
  }
  return specs;
}
