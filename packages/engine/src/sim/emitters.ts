import tgpu, { d, std, type TgpuRoot } from 'typegpu';
import { randf } from '@typegpu/noise';
import { GPU_PARTICLES, MAX_PARTICLES, PARTICLE_DENSITY, WATER } from '../config.ts';
import { Particle, SHAPE, type ParticleBuffer } from '../core/schemas.ts';
import { CHILL_COL, POISON_COL, SHOCK_COL } from '../statuscolors.ts';

const EFLOOR = PARTICLE_DENSITY.essentialFloor;

export function createGpuEmitters(
  root: TgpuRoot,
  particleBuf: ParticleBuffer,
  initialDensity: number,
) {
  const particles = root.createMutable(d.arrayOf(Particle, MAX_PARTICLES), particleBuf.buffer);
  const EmitState = d.struct({ cursor: d.atomic(d.u32), steamBursts: d.atomic(d.u32) });
  const emitStateBuf = root.createBuffer(EmitState).$usage('storage');
  const emitState = root.createMutable(EmitState, emitStateBuf.buffer);
  const steamBurstsOffset = d.memoryLayoutOf(EmitState, (state) => state.steamBursts).offset;
  const density = root.createUniform(d.f32, initialDensity);

  const reserve = (count: number) => {
    'use gpu';
    return std.atomicAdd(emitState.$.cursor, d.u32(count));
  };

  const writeParticle = tgpu.fn([d.u32, Particle])((slot, p) => {
    'use gpu';
    particles.$[slot % GPU_PARTICLES] = Particle(p);
  });

  const scaled = (n: number) => {
    'use gpu';
    return std.max(d.u32(1), d.u32(d.f32(n) * density.$ + 0.5));
  };

  const skipByDensity = (floor: number) => {
    'use gpu';
    return randf.sample() >= std.max(density.$, d.f32(floor));
  };

  const particle = (
    pos: d.v3f,
    vel: d.v3f,
    color: d.v3f,
    life: number,
    size: number,
    gravity: number,
    bounce: number,
  ) => {
    'use gpu';
    return Particle({
      pos: d.vec3f(pos),
      vel: d.vec3f(vel),
      color: d.vec3f(color),
      life,
      maxLife: life,
      size,
      gravity: d.f32(gravity),
      bounce: d.f32(bounce),
      stretch: 0,
      glow: 0,
      home: 0,
      shape: SHAPE.SPARK,
    });
  };

  const spawn = (
    slot: number,
    pos: d.v3f,
    vel: d.v3f,
    color: d.v3f,
    life: number,
    size: number,
    gravity: number,
    bounce: number,
  ) => {
    'use gpu';
    writeParticle(slot, particle(pos, vel, color, life, size, gravity, bounce));
  };

  const emitDeathBurst = (pos2: d.v2f) => {
    'use gpu';
    const nBones = scaled(12);
    const nDust = scaled(5);
    const base = reserve(nBones + nDust + 3);
    for (const k of std.range(12)) {
      if (d.u32(k) >= nBones) {
        break;
      }
      const dir = randf.inUnitCircle();
      const life = 0.7 + randf.sample() * 0.9;
      let p = particle(
        d.vec3f(pos2.x + dir.x * 0.25, 0.3 + randf.sample() * 0.9, pos2.y + dir.y * 0.25),
        d.vec3f(
          dir.x * (1.5 + randf.sample() * 5),
          2.5 + randf.sample() * 5,
          dir.y * (1.5 + randf.sample() * 5),
        ),
        d.vec3f(0.94, 0.91, 0.8),
        life,
        0.055 + randf.sample() * 0.09,
        24,
        0.45,
      );
      p.stretch = 0.35;
      writeParticle(base + d.u32(k), p);
    }
    for (const k of std.range(5)) {
      if (d.u32(k) >= nDust) {
        break;
      }
      const dir = randf.inUnitCircle();
      const life = 0.5 + randf.sample() * 0.6;
      spawn(
        base + nBones + d.u32(k),
        d.vec3f(pos2.x, 0.15 + randf.sample() * 0.4, pos2.y),
        d.vec3f(
          dir.x * (0.6 + randf.sample() * 1.8),
          0.5 + randf.sample() * 1.1,
          dir.y * (0.6 + randf.sample() * 1.8),
        ),
        d.vec3f(0.52, 0.5, 0.42),
        life,
        0.3 + randf.sample() * 0.35,
        1.2,
        0,
      );
    }
    for (const k of std.range(3)) {
      const dir = randf.inUnitCircle();
      const life = 1.2 + randf.sample() * 0.8;
      let p = particle(
        d.vec3f(pos2.x, 0.6 + randf.sample() * 0.6, pos2.y),
        d.vec3f(
          dir.x * (1 + randf.sample() * 2),
          2.2 + randf.sample() * 2,
          dir.y * (1 + randf.sample() * 2),
        ),
        d.vec3f(0.5, 1.5, 0.85),
        life,
        0.17 + randf.sample() * 0.1,
        -2,
        0,
      );
      p.stretch = 0.6;
      p.glow = 1;
      p.home = 1;
      p.shape = SHAPE.STAR;
      writeParticle(base + nBones + nDust + d.u32(k), p);
    }
  };

  const emitHitSparks = (pos2: d.v2f, dir: d.v2f, big: number) => {
    'use gpu';
    const n = scaled(4);
    const base = reserve(n);
    for (const k of std.range(4)) {
      if (d.u32(k) >= n) {
        break;
      }
      const spread = randf.inUnitCircle();
      const life = 0.15 + randf.sample() * 0.25;
      let p = particle(
        d.vec3f(pos2.x, 0.7 + randf.sample() * 0.6, pos2.y),
        d.vec3f(
          dir.x * (3 + randf.sample() * 5) + spread.x * 2.5,
          1 + randf.sample() * 3.5,
          dir.y * (3 + randf.sample() * 5) + spread.y * 2.5,
        ),
        d.vec3f(1.6, 1.25, 0.55) * (1 + big),
        life,
        (0.05 + randf.sample() * 0.06) * (1 + big * 0.35),
        6,
        0,
      );
      p.stretch = 0.9 + big * 0.55;
      p.glow = 1;
      writeParticle(base + d.u32(k), p);
    }
  };

  const emitIceBurst = (pos2: d.v2f, dir: d.v2f) => {
    'use gpu';
    const nChips = scaled(4);
    const nStars = scaled(2);
    const base = reserve(nChips + nStars);
    for (const k of std.range(4)) {
      if (d.u32(k) >= nChips) {
        break;
      }
      const spread = randf.inUnitCircle();
      const life = 0.15 + randf.sample() * 0.25;
      let p = particle(
        d.vec3f(pos2.x, 0.7 + randf.sample() * 0.6, pos2.y),
        d.vec3f(
          dir.x * (3 + randf.sample() * 5) + spread.x * 2.5,
          1 + randf.sample() * 3.5,
          dir.y * (3 + randf.sample() * 5) + spread.y * 2.5,
        ),
        d.vec3f(0.75, 0.95, 1.3) * (1.1 + randf.sample() * 0.5),
        life,
        0.05 + randf.sample() * 0.06,
        6,
        0.3,
      );
      p.stretch = 0.9;
      p.glow = 1;
      writeParticle(base + d.u32(k), p);
    }
    for (const k of std.range(2)) {
      if (d.u32(k) >= nStars) {
        break;
      }
      const spread = randf.inUnitCircle();
      const life = 0.2 + randf.sample() * 0.2;
      let p = particle(
        d.vec3f(pos2.x, 0.8 + randf.sample() * 0.5, pos2.y),
        d.vec3f(spread.x * 2, 2 + randf.sample() * 2.5, spread.y * 2),
        d.vec3f(0.9, 1.5, 2.2),
        life,
        0.08 + randf.sample() * 0.07,
        5,
        0,
      );
      p.glow = 1;
      p.shape = SHAPE.STAR;
      writeParticle(base + nChips + d.u32(k), p);
    }
  };

  const emitChainBurst = (pos2: d.v2f) => {
    'use gpu';
    const nArcs = scaled(6);
    const nCols = scaled(3);
    const base = reserve(nArcs + nCols);
    for (const k of std.range(6)) {
      if (d.u32(k) >= nArcs) {
        break;
      }
      const spread = randf.inUnitCircle();
      const life = 0.18 + randf.sample() * 0.22;
      let p = particle(
        d.vec3f(pos2.x, 0.8 + randf.sample() * 0.7, pos2.y),
        d.vec3f(
          spread.x * (4 + randf.sample() * 5),
          1 + randf.sample() * 4,
          spread.y * (4 + randf.sample() * 5),
        ),
        d.vec3f(1.1, 1.8, 3.4),
        life,
        0.05 + randf.sample() * 0.07,
        5,
        0,
      );
      p.stretch = 1.4;
      p.glow = 1;
      writeParticle(base + d.u32(k), p);
    }
    for (const k of std.range(3)) {
      if (d.u32(k) >= nCols) {
        break;
      }
      const life = 0.2 + randf.sample() * 0.15;
      let p = particle(
        d.vec3f(pos2.x + (randf.sample() - 0.5) * 0.4, 0.3, pos2.y + (randf.sample() - 0.5) * 0.4),
        d.vec3f(0, 9 + randf.sample() * 7, 0),
        d.vec3f(2.2, 2.6, 3.6),
        life,
        0.12 + randf.sample() * 0.08,
        0,
        0,
      );
      p.stretch = 2.6;
      p.glow = 1;
      writeParticle(base + nArcs + d.u32(k), p);
    }
  };

  const emitEmber = (pos2: d.v2f, heat: number) => {
    'use gpu';
    if (skipByDensity(0)) {
      return;
    }
    const base = reserve(1);
    if (randf.sample() < 0.62) {
      const life = 0.6 + randf.sample() * 0.9;
      let p = particle(
        d.vec3f(pos2.x, 0.05 + randf.sample() * 0.3, pos2.y),
        d.vec3f(
          (randf.sample() - 0.5) * 1.4,
          (0.8 + randf.sample() * 1.8) * (0.5 + heat),
          (randf.sample() - 0.5) * 1.4,
        ),
        d.vec3f(1.9, 0.55 + randf.sample() * 0.5, 0.14),
        life,
        0.05 + randf.sample() * 0.08,
        -1.5,
        0,
      );
      p.stretch = 0.7;
      p.glow = 1;
      writeParticle(base, p);
    } else {
      const life = 1.0 + randf.sample() * 1.2;
      spawn(
        base,
        d.vec3f(pos2.x, 0.2 + randf.sample() * 0.4, pos2.y),
        d.vec3f((randf.sample() - 0.5) * 0.9, 0.7 + randf.sample(), (randf.sample() - 0.5) * 0.9),
        d.vec3f(0.3, 0.28, 0.26),
        life,
        0.3 + randf.sample() * 0.35,
        -0.8,
        0,
      );
    }
  };

  const emitSpray = (pos2: d.v2f, flow: d.v2f) => {
    'use gpu';
    if (skipByDensity(0)) {
      return;
    }
    const base = reserve(1);
    const life = 0.35 + randf.sample() * 0.4;
    let p = particle(
      d.vec3f(pos2.x, 0.1 + randf.sample() * 0.25, pos2.y),
      d.vec3f(
        flow.x * (0.4 + randf.sample() * 0.4) + (randf.sample() - 0.5) * 1.2,
        1.4 + randf.sample() * 2.2,
        flow.y * (0.4 + randf.sample() * 0.4) + (randf.sample() - 0.5) * 1.2,
      ),
      d.vec3f(0.85, 1.15, 1.45),
      life,
      0.06 + randf.sample() * 0.09,
      9,
      0.15,
    );
    p.stretch = 1.1;
    p.glow = 1;
    writeParticle(base, p);
  };

  const emitSteam = (pos2: d.v2f) => {
    'use gpu';
    if (skipByDensity(0)) {
      return;
    }
    let budget = d.u32(WATER.steamBurstBudget.reduced);
    if (density.$ >= PARTICLE_DENSITY.tiers.normal) {
      budget = d.u32(WATER.steamBurstBudget.normal);
    }
    if (density.$ >= PARTICLE_DENSITY.tiers.full) {
      budget = d.u32(WATER.steamBurstBudget.full);
    }
    const ticket = std.atomicAdd(emitState.$.steamBursts, d.u32(1));
    if (ticket >= budget) {
      return;
    }
    const base = reserve(2);
    for (const k of std.range(2)) {
      const core = k === 0;
      const dir = randf.inUnitCircle();
      const life = (core ? 1.5 : 0.9) + randf.sample() * 1.1;
      let p = particle(
        d.vec3f(pos2.x + dir.x * 0.3, 0.25 + randf.sample() * 0.6, pos2.y + dir.y * 0.3),
        d.vec3f(
          dir.x * (core ? 0.6 : 2.6) + (randf.sample() - 0.5) * 1.4,
          (core ? 3.6 : 2.4) + randf.sample() * 3.2,
          dir.y * (core ? 0.6 : 2.6) + (randf.sample() - 0.5) * 1.4,
        ),
        d.vec3f(0.9, 0.93, 0.97),
        life,
        (core ? 0.85 : 0.5) + randf.sample() * 0.6,
        -1.8,
        0,
      );
      p.shape = SHAPE.STEAM;
      writeParticle(base + d.u32(k), p);
    }
  };

  const emitWaterArc = (pos2: d.v2f) => {
    'use gpu';
    if (skipByDensity(0)) {
      return;
    }
    const base = reserve(5);
    const ang = randf.sample() * 6.2831855;
    const dir = d.vec2f(std.cos(ang), std.sin(ang));
    const perp = d.vec2f(-dir.y, dir.x);
    let cur = d.vec3f(pos2.x, 0.06, pos2.y);
    for (const k of std.range(5)) {
      const side = std.select(d.f32(-1), d.f32(1), (d.u32(k) & 1) === 0);
      const lateral = (0.22 + randf.sample() * 0.4) * side;
      const fwd = 0.28 + randf.sample() * 0.32;
      const step = d.vec3f(
        dir.x * fwd + perp.x * lateral,
        0.08 + randf.sample() * 0.16,
        dir.y * fwd + perp.y * lateral,
      );
      const next = cur + step;
      const mid = (cur + next) * 0.5;
      const life = 0.06 + randf.sample() * 0.09;
      let p = particle(
        mid,
        step * 4.5,
        SHOCK_COL * (2.2 + randf.sample() * 1.4),
        life,
        0.035 + randf.sample() * 0.03,
        0,
        0,
      );
      p.stretch = 7;
      p.glow = 1;
      writeParticle(base + d.u32(k), p);
      cur = d.vec3f(next);
    }
  };

  const emitActorFlame = (pos2: d.v2f, intensity: number) => {
    'use gpu';
    if (skipByDensity(EFLOOR)) {
      return;
    }
    const base = reserve(3);
    for (const k of std.range(2)) {
      const dir = randf.inUnitCircle();
      const life = 0.22 + randf.sample() * 0.24;
      let p = particle(
        d.vec3f(
          pos2.x + dir.x * 0.28,
          0.3 + randf.sample() * (0.7 + intensity * 0.7),
          pos2.y + dir.y * 0.28,
        ),
        d.vec3f(dir.x * 0.8, (1.8 + randf.sample() * 2.4) * (0.7 + intensity * 0.6), dir.y * 0.8),
        d.vec3f(2.0, 0.6 + randf.sample() * 0.5, 0.12) * (0.75 + intensity * 0.5),
        life,
        (0.1 + randf.sample() * 0.12) * (0.8 + intensity * 0.4),
        -3,
        0,
      );
      p.stretch = 1.6;
      p.glow = 1;
      writeParticle(base + d.u32(k), p);
    }
    if (randf.sample() < intensity * 0.5) {
      const snap = reserve(1);
      const dir = randf.inUnitCircle();
      const eLife = 0.45 + randf.sample() * 0.5;
      let p = particle(
        d.vec3f(pos2.x, 0.9 + randf.sample() * 0.8, pos2.y),
        d.vec3f(
          dir.x * (1.5 + randf.sample() * 2),
          2.5 + randf.sample() * 3,
          dir.y * (1.5 + randf.sample() * 2),
        ),
        d.vec3f(2.6, 1.1, 0.2),
        eLife,
        0.05 + randf.sample() * 0.05,
        3,
        0,
      );
      p.stretch = 0.8;
      p.glow = 1;
      p.shape = SHAPE.STAR;
      writeParticle(snap, p);
    }
    const sLife = 0.5 + randf.sample() * 0.5;
    spawn(
      base + 2,
      d.vec3f(pos2.x, 1.2 + randf.sample() * 0.5, pos2.y),
      d.vec3f((randf.sample() - 0.5) * 0.8, 1.2 + randf.sample(), (randf.sample() - 0.5) * 0.8),
      d.vec3f(0.28, 0.26, 0.24),
      sLife,
      0.22 + randf.sample() * 0.2,
      -1,
      0,
    );
  };

  const emitPoisonDrip = (pos2: d.v2f) => {
    'use gpu';
    if (skipByDensity(0)) {
      return;
    }
    const base = reserve(1);
    const dir = randf.inUnitCircle();
    const life = 0.35 + randf.sample() * 0.35;
    let drip = particle(
      d.vec3f(pos2.x + dir.x * 0.25, 0.5 + randf.sample() * 0.8, pos2.y + dir.y * 0.25),
      d.vec3f(dir.x * 0.5, -0.4 - randf.sample() * 0.8, dir.y * 0.5),
      POISON_COL * 0.8,
      life,
      0.045 + randf.sample() * 0.05,
      9,
      0,
    );
    drip.stretch = 1.2;
    drip.glow = 1;
    writeParticle(base, drip);
    if (randf.sample() < 0.35) {
      const bub = reserve(1);
      const bDir = randf.inUnitCircle();
      const bLife = 0.4 + randf.sample() * 0.4;
      let bubble = particle(
        d.vec3f(pos2.x + bDir.x * 0.2, 0.8 + randf.sample() * 0.7, pos2.y + bDir.y * 0.2),
        d.vec3f(bDir.x * 0.3, 0.6 + randf.sample() * 0.8, bDir.y * 0.3),
        POISON_COL,
        bLife,
        0.055 + randf.sample() * 0.045,
        -1.2,
        0,
      );
      bubble.shape = SHAPE.BUBBLE;
      writeParticle(bub, bubble);
    }
  };

  const emitPoisonCloud = (pos2: d.v2f) => {
    'use gpu';
    if (skipByDensity(EFLOOR)) {
      return;
    }
    const base = reserve(1);
    const dir = randf.inUnitCircle();
    const life = 1.1 + randf.sample() * 0.8;
    let cloud = particle(
      d.vec3f(pos2.x + dir.x * 0.45, 0.3 + randf.sample() * 1.0, pos2.y + dir.y * 0.45),
      d.vec3f(dir.x * 0.35, 0.25 + randf.sample() * 0.4, dir.y * 0.35),
      d.vec3f(0.3, 0.58, 0.22),
      life,
      0.38 + randf.sample() * 0.34,
      -0.25,
      0,
    );
    cloud.shape = SHAPE.VAPOR;
    writeParticle(base, cloud);
    if (randf.sample() < 0.3) {
      const mote = reserve(1);
      const mDir = randf.inUnitCircle();
      const mLife = 0.6 + randf.sample() * 0.5;
      let moteParticle = particle(
        d.vec3f(pos2.x + mDir.x * 0.4, 0.5 + randf.sample() * 0.9, pos2.y + mDir.y * 0.4),
        d.vec3f(mDir.x * 0.3, 0.35 + randf.sample() * 0.4, mDir.y * 0.3),
        POISON_COL * 0.55,
        mLife,
        0.14 + randf.sample() * 0.12,
        -0.5,
        0,
      );
      moteParticle.glow = 1;
      writeParticle(mote, moteParticle);
    }
  };

  const emitVenomBurst = (pos2: d.v2f, dir: d.v2f) => {
    'use gpu';
    const nDrops = scaled(4);
    const base = reserve(nDrops + 1);
    for (const k of std.range(4)) {
      if (d.u32(k) >= nDrops) {
        break;
      }
      const spread = randf.inUnitCircle();
      const life = 0.2 + randf.sample() * 0.3;
      let p = particle(
        d.vec3f(pos2.x, 0.7 + randf.sample() * 0.5, pos2.y),
        d.vec3f(
          dir.x * (2 + randf.sample() * 4) + spread.x * 3,
          1.5 + randf.sample() * 3,
          dir.y * (2 + randf.sample() * 4) + spread.y * 3,
        ),
        POISON_COL * (0.9 + randf.sample() * 0.5),
        life,
        0.05 + randf.sample() * 0.06,
        10,
        0,
      );
      p.stretch = 1.1;
      p.glow = 1;
      writeParticle(base + d.u32(k), p);
    }
    const fLife = 0.12 + randf.sample() * 0.08;
    let p = particle(
      d.vec3f(pos2.x, 0.9, pos2.y),
      d.vec3f(0, 0.5, 0),
      POISON_COL * 1.6,
      fLife,
      0.18 + randf.sample() * 0.1,
      0,
      0,
    );
    p.glow = 1;
    p.shape = SHAPE.RING;
    writeParticle(base + nDrops, p);
  };

  const emitShockArc = (pos2: d.v2f) => {
    'use gpu';
    if (skipByDensity(EFLOOR)) {
      return;
    }
    const base = reserve(4);
    for (const k of std.range(4)) {
      const dir = randf.inUnitCircle();
      const life = 0.07 + randf.sample() * 0.13;
      let p = particle(
        d.vec3f(pos2.x + dir.x * 0.35, 0.4 + randf.sample() * 1.1, pos2.y + dir.y * 0.35),
        d.vec3f(
          dir.x * (4 + randf.sample() * 5),
          (randf.sample() - 0.35) * 6,
          dir.y * (4 + randf.sample() * 5),
        ),
        SHOCK_COL * (1.3 + randf.sample() * 0.8),
        life,
        0.045 + randf.sample() * 0.06,
        4,
        0,
      );
      p.stretch = 3.2;
      p.glow = 1;
      writeParticle(base + d.u32(k), p);
    }
    if (randf.sample() < 0.3) {
      const snap = reserve(1);
      const sLife = 0.1 + randf.sample() * 0.08;
      let p = particle(
        d.vec3f(pos2.x, 0.7 + randf.sample() * 0.6, pos2.y),
        d.vec3f(0, 1 + randf.sample() * 2, 0),
        SHOCK_COL * 2.2,
        sLife,
        0.16 + randf.sample() * 0.12,
        0,
        0,
      );
      p.glow = 1;
      p.shape = SHAPE.STAR;
      writeParticle(snap, p);
    }
  };

  const emitChillMist = (pos2: d.v2f) => {
    'use gpu';
    if (skipByDensity(EFLOOR)) {
      return;
    }
    const base = reserve(2);
    for (const k of std.range(2)) {
      const dir = randf.inUnitCircle();
      const life = 0.5 + randf.sample() * 0.6;
      let p = particle(
        d.vec3f(pos2.x + dir.x * 0.3, 0.5 + randf.sample() * 1.1, pos2.y + dir.y * 0.3),
        d.vec3f(dir.x * 0.4, -0.25 - randf.sample() * 0.5, dir.y * 0.4),
        CHILL_COL * 1.4,
        life,
        0.04 + randf.sample() * 0.05,
        1.5,
        0,
      );
      p.glow = 1;
      p.shape = SHAPE.STAR;
      writeParticle(base + d.u32(k), p);
    }
    if (randf.sample() < 0.2) {
      const wisp = reserve(1);
      const dir = randf.inUnitCircle();
      const life = 0.8 + randf.sample() * 0.6;
      let p = particle(
        d.vec3f(pos2.x + dir.x * 0.3, 0.2 + randf.sample() * 0.6, pos2.y + dir.y * 0.3),
        d.vec3f(dir.x * 0.5, 0.15 + randf.sample() * 0.3, dir.y * 0.5),
        d.vec3f(0.5, 0.62, 0.82),
        life,
        0.28 + randf.sample() * 0.24,
        -0.3,
        0,
      );
      p.shape = SHAPE.VAPOR;
      writeParticle(wisp, p);
    }
  };

  const emitPyreBlast = (pos2: d.v2f) => {
    'use gpu';
    const nEmbers = scaled(8);
    const nTongues = scaled(4);
    const base = reserve(nEmbers + nTongues + 2);
    for (const k of std.range(8)) {
      if (d.u32(k) >= nEmbers) {
        break;
      }
      const dir = randf.inUnitCircle();
      const life = 0.35 + randf.sample() * 0.4;
      let p = particle(
        d.vec3f(pos2.x + dir.x * 0.2, 0.5 + randf.sample() * 0.7, pos2.y + dir.y * 0.2),
        d.vec3f(
          dir.x * (7 + randf.sample() * 9),
          1.5 + randf.sample() * 4,
          dir.y * (7 + randf.sample() * 9),
        ),
        d.vec3f(2.4, 0.9, 0.16),
        life,
        0.07 + randf.sample() * 0.08,
        7,
        0.3,
      );
      p.stretch = 2.4;
      p.glow = 1;
      writeParticle(base + d.u32(k), p);
    }
    for (const k of std.range(4)) {
      if (d.u32(k) >= nTongues) {
        break;
      }
      const dir = randf.inUnitCircle();
      const life = 0.3 + randf.sample() * 0.35;
      let p = particle(
        d.vec3f(pos2.x + dir.x * 0.4, 0.25 + randf.sample() * 0.5, pos2.y + dir.y * 0.4),
        d.vec3f(dir.x * 1.5, 3.5 + randf.sample() * 3, dir.y * 1.5),
        d.vec3f(2.6, 1.1, 0.2),
        life,
        0.2 + randf.sample() * 0.2,
        -1.5,
        0,
      );
      p.stretch = 0.6;
      p.glow = 1;
      writeParticle(base + nEmbers + d.u32(k), p);
    }
    for (const k of std.range(2)) {
      const life = 0.12 + randf.sample() * 0.08;
      let p = particle(
        d.vec3f(pos2.x, 0.7 + randf.sample() * 0.4, pos2.y),
        d.vec3f(0, 1, 0),
        d.vec3f(4.5, 2.0, 0.5),
        life,
        0.45 + randf.sample() * 0.3,
        0,
        0,
      );
      p.glow = 1;
      p.shape = SHAPE.RING;
      writeParticle(base + nEmbers + nTongues + d.u32(k), p);
    }
  };

  return {
    emitDeathBurst,
    emitHitSparks,
    emitChainBurst,
    emitEmber,
    emitSpray,
    emitSteam,
    emitWaterArc,
    emitActorFlame,
    emitPoisonDrip,
    emitPoisonCloud,
    emitShockArc,
    emitChillMist,
    emitIceBurst,
    emitVenomBurst,
    emitPyreBlast,
    beginFrame(enc: GPUCommandEncoder) {
      enc.clearBuffer(emitStateBuf.buffer, steamBurstsOffset, 4);
    },
    reset() {
      emitStateBuf.write({ cursor: 0, steamBursts: 0 });
    },
    setDensity(v: number) {
      density.write(v);
    },
  };
}

export type GpuEmitters = ReturnType<typeof createGpuEmitters>;
