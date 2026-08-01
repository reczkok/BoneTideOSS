/**
 * The GPU enemy simulation. Each tick, one thread per actor slot copies the
 * actor into a local, runs it through the damage, status, movement and
 * animation stages below (each a helper mutating that local through a
 * `d.ref`), and writes it back once. Chain lightning, the neighbour grid,
 * trample, fire and water fields record into the same caller-owned encoder.
 */
import tgpu, { d, std, type TgpuRoot, type TgpuUniform } from 'typegpu';
import { randf } from '@typegpu/noise';
import type { BakedClipMeta } from '../assets/anim.ts';
import {
  ARENA_RADIUS,
  BLADES,
  BOSS,
  CHAIN,
  ENEMY_TYPES,
  FIELD,
  FIRE,
  KEYSTONES,
  MAX_BLADES,
  MAX_CRESCENT,
  MAX_ENEMIES,
  MAX_SPIKE_ROCKS,
  MAX_VOLLEY,
  METEOR,
  PLAYER,
  PLAYER_ANIM,
  ROCK_IGNORE_BEYOND,
  ROCK_STEER_MARGIN,
  SEP_GRID,
  SHOCK,
  SPIKES,
  STATUS,
  VOLLEY,
  WATER,
  WELL,
} from '../config.ts';
import { CLIP } from '../core/animation.ts';
import { headingDir, lateral, perp } from '../core/gpu.ts';
import { createKernel } from '../core/kernel.ts';
import { bladeAngle, flightPos, orbitPos } from '../core/kinematics.ts';
import { perlinRoot } from '../core/perlincache.ts';
import {
  Actor,
  ACTOR_FLAGS,
  type ActorBuffer,
  ActorSnap,
  type ActorSnapBuffer,
  type ChainBuffer,
  ChainState,
  type CpuRecord,
  CrescentWave,
  KEYSTONE_BITS,
  makeActor,
  type ParticleBuffer,
  SimParams,
  STATE,
  type TrampleBuffer,
  VolleyArrow,
  type VolleyBuffer,
} from '../core/schemas.ts';
import type { RockCollider } from '../core/world.ts';
import { simParams } from './bindings.ts';
import { createGpuEmitters } from './emitters.ts';
import { createFieldTextures, fieldCoord, type FieldTextures, inField } from './field.ts';
import { createFireField, pristineFieldCells } from './fire.ts';
import { createNeighborGrid } from './grid.ts';
import { createTrampleField } from './trample.ts';
import { createWaterField } from './water.ts';

export interface VolleyArrowSpec {
  origin: [number, number];
  dir: [number, number];
  start: number;
  damage: number;
}

export interface Sim {
  params: TgpuUniform<typeof SimParams>;
  trampleBuf: TrampleBuffer;
  fieldTex: FieldTextures;
  chainBuf: ChainBuffer;
  volleyBuf: VolleyBuffer;
  actorSnapBuf: ActorSnapBuffer;
  queueChain(): void;
  igniteFire(px: number, pz: number, dx: number, dz: number): void;
  igniteAt(px: number, pz: number, r: number, heatFrac: number): void;
  surgeWater(px: number, pz: number, dx: number, dz: number, power: number, riptide: boolean): void;
  waterActive(): boolean;
  castVolley(arrows: readonly VolleyArrowSpec[]): void;
  castCrescent(
    origin: [number, number],
    dir: [number, number],
    start: number,
    damage: number,
    kind: number,
  ): void;
  setDynamicRocks(rocks: readonly RockCollider[]): void;
  setParticleDensity(v: number): void;
  run(dt: number, enc: GPUCommandEncoder): void;
  fireActive(): boolean;
  fieldDirtyThisFrame(): boolean;
  reset(): void;
}

type ActorRef = d.ref<d.InferGPU<typeof Actor>>;

const Rock = d.struct({ pos: d.vec2f, r: d.f32 });

const BURN_DECAY = 1 / STATUS.burn.afterburn;
const BLEND_DUR = PLAYER_ANIM.blendDur;
const VOLLEY_LIFE = VOLLEY.range / VOLLEY.speed;
const FREEZE_T = KEYSTONES.flashFreeze.freezeThreshold;
const IDLE_VOLLEY: VolleyArrowSpec = { origin: [0, 0], dir: [1, 0], start: -100, damage: 0 };
const IDLE_CRESCENT: d.InferInput<typeof CrescentWave> = {
  origin: [0, 0],
  dir: [1, 0],
  start: -100,
  damage: 0,
  kind: 0,
};

/** Per-enemy-type tables, baked into the shader as constants. */
const TypeTable = d.arrayOf(d.f32, ENEMY_TYPES.length);
const typeTable = (pick: (t: (typeof ENEMY_TYPES)[number]) => number) =>
  tgpu.const(TypeTable, ENEMY_TYPES.map(pick));
const speeds = typeTable((t) => t.speed);
const animRates = typeTable((t) => t.animRate);
const holdRanges = typeTable((t) => t.holdRange ?? 0);
/** (front damage factor, cos of half guard arc) per enemy type. */
const guards = tgpu.const(
  d.arrayOf(d.vec2f, ENEMY_TYPES.length),
  ENEMY_TYPES.map((t) =>
    d.vec2f(t.guard?.frontFactor ?? 1, Math.cos((((t.guard?.arc ?? 0) / 2) * Math.PI) / 180)),
  ),
);

const keystone = (bit: number) => {
  'use gpu';
  return (simParams.$.keystoneBits & d.u32(bit)) !== 0;
};

const isBoss = (a: ActorRef) => {
  'use gpu';
  return (a.$.flags & ACTOR_FLAGS.BOSS) !== 0;
};

const radialKnock = (ndir: d.v2f, base: number, radius: number, falloff: number) => {
  'use gpu';
  return ndir * (d.f32(base) * (0.45 / radius) * (0.4 + 0.6 * falloff));
};

export function createSim(
  root: TgpuRoot,
  enemyBuf: ActorBuffer,
  particleBuf: ParticleBuffer,
  clips: BakedClipMeta[],
  colliders: RockCollider[],
  particleDensity: number,
): Sim {
  const params = root.createUniform(SimParams);
  const gpu = perlinRoot(root).with(simParams, params);
  const enemies = enemyBuf.as('mutable');
  const emitters = createGpuEmitters(root, particleBuf, particleDensity);
  const trample = createTrampleField(root, gpu, enemyBuf);
  const fieldBuf = root
    .createBuffer(d.arrayOf(d.i32, FIRE.cells * FIRE.cells * FIELD.STRIDE), pristineFieldCells())
    .$usage('storage');
  const fire = createFireField(gpu, emitters, fieldBuf);
  const water = createWaterField(root, gpu, emitters, fieldBuf);
  const fieldTex = createFieldTextures(root, fieldBuf);
  const fieldA = fieldTex.sampledA;
  const fieldB = fieldTex.sampledB;
  const grid = createNeighborGrid(root, enemyBuf);

  const N_STATIC_ROCKS = colliders.length;
  const N_ROCKS = N_STATIC_ROCKS + MAX_SPIKE_ROCKS;
  const rockScratch: CpuRecord<typeof Rock>[] = [
    ...colliders.map((c): CpuRecord<typeof Rock> => ({ pos: [c.x, c.z], r: c.r })),
    ...Array.from(
      { length: MAX_SPIKE_ROCKS },
      (): CpuRecord<typeof Rock> => ({ pos: [0, 0], r: 0 }),
    ),
  ];
  const rocks = root.createUniform(d.arrayOf(Rock, N_ROCKS), rockScratch);

  const SPAWN_DUR = clips[CLIP.SPAWN].duration;

  const volleyBuf = root
    .createBuffer(d.arrayOf(VolleyArrow, MAX_VOLLEY))
    .$usage('storage', 'uniform');
  const volley = volleyBuf.as('uniform');
  const crescentBuf = root.createBuffer(d.arrayOf(CrescentWave, MAX_CRESCENT)).$usage('uniform');
  const crescents = crescentBuf.as('uniform');
  const crescentScratch = Array.from({ length: MAX_CRESCENT }, () => ({ ...IDLE_CRESCENT }));
  let crescentSlot = 0;

  const chainBuf = root.createBuffer(ChainState).$usage('storage');
  const chain = chainBuf.as('mutable');
  const snapBuf = root.createBuffer(d.arrayOf(ActorSnap, MAX_ENEMIES)).$usage('storage');
  const snaps = snapBuf.as('mutable');

  // ---- Damage helpers -----------------------------------------------------

  /** Damage multiplier when an attack from `incoming` lands on a guarding enemy's front. */
  const guardMul = (a: ActorRef, incoming: d.v2f) => {
    'use gpu';
    const g = guards.$[a.$.typeId];
    const frontal = std.dot(headingDir(a.$.heading), incoming * -1) > g.y;
    return std.select(d.f32(1), g.x, frontal && a.$.attackT <= 0);
  };

  /** Applies a hit: damage, flash, knockback; sparks only if the actor survives. */
  const hit = (a: ActorRef, damage: number, knock: d.v2f, sparkDir: d.v2f, sparkSize: number) => {
    'use gpu';
    a.$.hp -= damage;
    a.$.flash = 1;
    a.$.vel += knock;
    if (a.$.hp > 0 && sparkSize > 0) {
      emitters.emitHitSparks(a.$.pos, sparkDir, sparkSize);
    }
  };

  /** Puts an actor into its death animation and clears its statuses. */
  const kill = (a: ActorRef) => {
    'use gpu';
    emitters.emitDeathBurst(a.$.pos);
    if (keystone(KEYSTONE_BITS.pyre) && a.$.burnH > KEYSTONES.pyre.burnThreshold) {
      emitters.emitPyreBlast(a.$.pos);
    }
    a.$.vel = d.vec2f();
    a.$.hp = 0;
    a.$.state = STATE.DYING;
    a.$.prevClip = a.$.animClip;
    a.$.prevTime = a.$.animTime;
    a.$.blendT = BLEND_DUR;
    a.$.animClip = CLIP.DEATH;
    a.$.animTime = 0;
    a.$.attackT = 0;
    a.$.windupT = 0;
    a.$.dashT = 0;
    a.$.flash = 1;
    a.$.stunT = 0;
    a.$.poisonT = 0;
    a.$.chillT = 0;
    a.$.shockT = 0;
    a.$.drenchT = 0;
  };

  const playerMelee = (a: ActorRef) => {
    'use gpu';
    const p = simParams.$;
    const rel = a.$.pos - p.attackOrigin;
    const dist = std.length(rel);
    if (dist < p.attackRange && dist > 1e-4) {
      const ndir = rel * (1 / dist);
      if (std.dot(ndir, p.attackDir) > p.attackArcCos) {
        hit(a, p.attackDamage * guardMul(a, ndir), ndir * p.attackKnock, ndir, d.f32(0.6));
      }
    }
  };

  /** Crescent waves sweep forward; an actor is hit the tick the front crosses it. */
  const crescentWaves = (a: ActorRef, prevVel: d.v2f) => {
    'use gpu';
    const p = simParams.$;
    for (const k of std.range(MAX_CRESCENT)) {
      if (a.$.hp <= 0) break;
      const w = crescents.$[k];
      const age = p.time - w.start;
      const thrust = w.kind > 0.5;
      const speed = std.select(
        d.f32(KEYSTONES.crescent.speed),
        d.f32(KEYSTONES.crescent.thrust.speed),
        thrust,
      );
      const range = std.select(
        d.f32(KEYSTONES.crescent.range),
        d.f32(KEYSTONES.crescent.thrust.range),
        thrust,
      );
      const halfWidth = std.select(
        d.f32(KEYSTONES.crescent.halfWidth),
        d.f32(KEYSTONES.crescent.thrust.halfWidth),
        thrust,
      );
      const knock = std.select(
        d.f32(KEYSTONES.crescent.knock),
        d.f32(KEYSTONES.crescent.thrust.knock),
        thrust,
      );
      if (w.damage > 0 && age >= 0 && age - p.dt < range / speed) {
        const rel = a.$.pos - w.origin;
        const along = std.dot(rel, w.dir);
        const lat = -lateral(rel, w.dir);
        const front = std.min(age * speed, range);
        const prevFront = std.max(0, (age - p.dt) * speed);
        const alongPrev = along - std.dot(prevVel, w.dir) * p.dt;
        const gap = along - a.$.radius - front;
        const prevGap = alongPrev - a.$.radius - prevFront;
        if (gap < 0 && prevGap >= 0 && std.abs(lat) < halfWidth + a.$.radius) {
          hit(a, w.damage * guardMul(a, w.dir), w.dir * knock, w.dir, d.f32(0.6));
        }
      }
    }
  };

  const meteorBlast = (a: ActorRef) => {
    'use gpu';
    const p = simParams.$;
    const rel = a.$.pos - p.meteorPos;
    const dist = std.length(rel);
    if (dist < p.meteorRadius && dist > 1e-4) {
      const falloff = 1 - dist / p.meteorRadius;
      const ndir = rel * (1 / dist);
      const knock = radialKnock(ndir, METEOR.knock, a.$.radius, falloff);
      hit(a, p.meteorDamage * (0.45 + 0.55 * falloff), knock, ndir, d.f32(1));
    }
  };

  const novaRing = (a: ActorRef) => {
    'use gpu';
    const p = simParams.$;
    const reach = SHOCK.maxRadius + SHOCK.width;
    const rNow = (p.time - p.shockStart) * SHOCK.speed;
    const rPrev = std.max(0, rNow - p.dt * SHOCK.speed);
    if (rNow < reach) {
      const rel = a.$.pos - p.shockOrigin;
      const dist = std.length(rel);
      if (dist > 1e-4 && dist >= rPrev && dist < rNow + SHOCK.width) {
        const falloff = 1 - dist / reach;
        const ndir = rel * (1 / dist);
        const dmgT = std.smoothstep(SHOCK.dmgFullFrac, 1, dist / reach);
        const knock = radialKnock(ndir, SHOCK.knock, a.$.radius, falloff);
        hit(a, p.novaDamage * (1 - dmgT * (1 - SHOCK.dmgEdgeFrac)), knock, ndir, d.f32(1));
      }
    }
  };

  const spikeLane = (a: ActorRef) => {
    'use gpu';
    const p = simParams.$;
    const front = (p.time - p.spikeStart) * SPIKES.speed;
    if (front < SPIKES.range + 1) {
      const rel = a.$.pos - p.spikeOrigin;
      const along = std.dot(rel, p.spikeDir);
      const lat = lateral(rel, p.spikeDir);
      const prevFront = std.max(0, front - p.dt * SPIKES.speed);
      if (
        along >= prevFront &&
        along < std.min(front, SPIKES.range) &&
        std.abs(lat) < SPIKES.width + a.$.radius
      ) {
        const side = std.select(d.f32(-1), d.f32(1), lat >= 0);
        const kdir = d.vec2f(p.spikeDir.y, -p.spikeDir.x) * (side * 0.8) + p.spikeDir * 0.5;
        hit(
          a,
          p.spikeDamage,
          radialKnock(kdir, SPIKES.knock, a.$.radius, d.f32(1)),
          kdir,
          d.f32(0),
        );
        if (a.$.hp > 0) {
          a.$.chillT = std.max(a.$.chillT, SPIKES.chillDuration);
          emitters.emitIceBurst(a.$.pos, kdir);
        }
      }
    }
  };

  /** Standing in fire ignites; standing in steam scalds. */
  const fireField = (a: ActorRef) => {
    'use gpu';
    const p = simParams.$;
    const cell = fieldCoord(a.$.pos);
    if (!inField(cell)) return;
    const heat = std.textureLoad(fieldA.$, cell, 0).y;
    if (heat > FIRE.dotThreshold) {
      a.$.burnH = std.max(a.$.burnH, std.min(heat, 1.2));
    }
    const steam = std.textureLoad(fieldB.$, cell, 0).z;
    if (steam > WATER.steamScaldThreshold) {
      a.$.hp -= p.fireDps * WATER.steamScald * p.dt;
      if (randf.sample() < p.dt * 1.5) {
        emitters.emitSteam(a.$.pos);
      }
    }
  };

  /** Deep water drenches, conducts the water zap, and pushes with the flow. */
  const waterField = (a: ActorRef) => {
    'use gpu';
    const p = simParams.$;
    const cell = fieldCoord(a.$.pos);
    if (!inField(cell)) return;
    const depth = std.textureLoad(fieldA.$, cell, 0).z;
    if (depth <= WATER.drenchThreshold) return;
    a.$.drenchT = std.max(a.$.drenchT, WATER.drenchDuration);
    const zapT = p.time - p.waterZapStart;
    if (p.waterZapStart >= 0 && zapT >= 0 && zapT < WATER.zapDuration) {
      a.$.hp -= p.waterZapDps * p.dt;
      a.$.shockT = std.max(a.$.shockT, WATER.zapStun + 0.2);
      a.$.stunT = std.max(a.$.stunT, WATER.zapStun);
      a.$.flash = std.max(a.$.flash, 0.4);
    }
    const flow = std.textureLoad(fieldB.$, cell, 0).xy;
    const fSpeed = std.length(flow);
    if (fSpeed > WATER.pushThreshold) {
      const boss = isBoss(a);
      const heft = std.select(d.f32(0.45 / a.$.radius), d.f32(WATER.bossPushFactor), boss);
      if (std.length(a.$.vel) < WATER.maxPushSpeed) {
        a.$.vel += flow * (WATER.pushFactor * heft * p.dt);
      }
      if (keystone(KEYSTONE_BITS.undertow) && fSpeed > 1 && !boss) {
        if (std.length(a.$.vel) < WATER.maxPushSpeed) {
          a.$.vel += flow * ((1 / fSpeed) * KEYSTONES.undertow.dragAccel * p.dt);
        }
        if (randf.sample() < p.dt * KEYSTONES.undertow.churnRate) {
          emitters.emitSpray(a.$.pos, flow);
        }
      }
    }
  };

  const wellRadius = () => {
    'use gpu';
    return std.select(
      d.f32(WELL.radius),
      d.f32(WELL.radius + KEYSTONES.singularity.radiusBonus),
      keystone(KEYSTONE_BITS.singularity),
    );
  };

  const wellDetonation = (a: ActorRef) => {
    'use gpu';
    const p = simParams.$;
    const rad = wellRadius();
    const rel = a.$.pos - p.wellPos;
    const dist = std.length(rel);
    if (dist < rad && dist > 1e-4) {
      const falloff = 1 - dist / rad;
      const ndir = rel * (1 / dist);
      const knock = radialKnock(ndir, WELL.knock, a.$.radius, falloff);
      hit(a, p.wellDetonate * (0.5 + 0.5 * falloff), knock, ndir, d.f32(1));
    }
  };

  const orbitingBlades = (a: ActorRef) => {
    'use gpu';
    const p = simParams.$;
    for (const k of std.range(MAX_BLADES)) {
      if (d.u32(k) >= p.bladeCount || a.$.hp <= 0) break;
      const ang = bladeAngle(p.time, d.f32(k), d.f32(p.bladeCount));
      const rel = a.$.pos - orbitPos(p.playerPos, ang, p.bladeOrbit);
      const dist = std.length(rel);
      if (dist < a.$.radius + BLADES.reach && dist > 1e-4) {
        a.$.hp -= p.bladeDps * p.dt;
        a.$.flash = std.max(a.$.flash, 0.55);
        const outv = a.$.pos - p.playerPos;
        const olen = std.length(outv);
        if (olen > 1e-3) {
          const outn = outv * (1 / olen);
          a.$.vel += (outn + d.vec2f(outn.y, -outn.x) * 0.55) * (2.2 * p.dt * 60);
        }
      }
    }
  };

  /** Volley arrows hit on entry; with Toxic Wake their trail keeps poisoning. */
  const volleyArrows = (a: ActorRef) => {
    'use gpu';
    const p = simParams.$;
    const toxicWake = keystone(KEYSTONE_BITS.toxicWake);
    for (const k of std.range(MAX_VOLLEY)) {
      const arrow = volley.$[k];
      const age = p.time - arrow.start;
      if (arrow.damage <= 0 || age < 0) continue;
      if (age < VOLLEY_LIFE && a.$.hp > 0) {
        const reach = a.$.radius + 0.3;
        const inNow =
          std.distance(a.$.pos, flightPos(arrow.origin, arrow.dir, age, VOLLEY.speed)) < reach;
        const prevAge = std.max(0, age - p.dt);
        const inPrev =
          std.distance(a.$.pos, flightPos(arrow.origin, arrow.dir, prevAge, VOLLEY.speed)) < reach;
        if (inNow && !inPrev) {
          const knock = std.select(
            d.vec2f(),
            arrow.dir * VOLLEY.knock,
            std.length(a.$.vel) < VOLLEY.knockCap,
          );
          hit(a, arrow.damage * guardMul(a, arrow.dir), knock, arrow.dir, d.f32(0));
          if (a.$.hp > 0) {
            a.$.stunT = std.max(a.$.stunT, VOLLEY.staggerTime);
            a.$.poisonT = std.max(a.$.poisonT, VOLLEY.poisonDuration);
            emitters.emitVenomBurst(a.$.pos, arrow.dir);
          }
        }
      }
      if (toxicWake && age < VOLLEY_LIFE + KEYSTONES.toxicWake.linger) {
        const segLen = std.min(age, VOLLEY_LIFE) * VOLLEY.speed;
        const relW = a.$.pos - arrow.origin;
        const along = std.clamp(std.dot(relW, arrow.dir), 0, segLen);
        const wakePoint = arrow.origin + arrow.dir * along;
        const dry = 1 - std.smoothstep(VOLLEY_LIFE, VOLLEY_LIFE + KEYSTONES.toxicWake.linger, age);
        if (std.distance(a.$.pos, wakePoint) < KEYSTONES.toxicWake.radius * (0.4 + 0.6 * dry)) {
          a.$.poisonT = std.max(a.$.poisonT, VOLLEY.poisonDuration);
        }
      }
    }
  };

  // ---- Status, movement and animation helpers -----------------------------

  const statusParticles = (a: ActorRef) => {
    'use gpu';
    const dt = simParams.$.dt;
    if (a.$.poisonT > 0 && randf.sample() < dt * STATUS.poison.dripRate) {
      emitters.emitPoisonDrip(a.$.pos);
    }
    if (a.$.poisonT > 0 && randf.sample() < dt * STATUS.poison.cloudRate) {
      emitters.emitPoisonCloud(a.$.pos);
    }
    const arcMul = std.select(d.f32(1), d.f32(2), a.$.shockT > CHAIN.stunTime * 0.5);
    if (a.$.shockT > 0 && randf.sample() < dt * STATUS.shock.arcRate * arcMul) {
      emitters.emitShockArc(a.$.pos);
    }
    if (a.$.chillT > 0 && randf.sample() < dt * STATUS.chill.mistRate) {
      emitters.emitChillMist(a.$.pos);
    }
    if (a.$.burnH > 0.12 && randf.sample() < dt * STATUS.burn.flameRate * a.$.burnH) {
      emitters.emitActorFlame(a.$.pos, a.$.burnH);
    }
  };

  const wellPull = (a: ActorRef) => {
    'use gpu';
    const p = simParams.$;
    const wt = p.time - p.wellStart;
    if (wt < 0 || wt >= WELL.duration) return;
    const single = keystone(KEYSTONE_BITS.singularity);
    const rad = wellRadius();
    const pull = std.select(
      d.f32(WELL.pullStrength),
      d.f32(WELL.pullStrength * KEYSTONES.singularity.pullMult),
      single,
    );
    const rel = p.wellPos - a.$.pos;
    const dr = std.length(rel);
    if (dr > 1e-3 && dr < rad) {
      const inward = rel * (1 / dr);
      const ramp = std.min(std.min(wt * 4, 1), (WELL.duration - wt) * 2.5);
      const prof = std.smoothstep(rad, rad * 0.1, dr) * ramp;
      a.$.vel += (inward + perp(inward) * WELL.swirl) * (pull * prof * p.dt);
    }
  };

  /** Chase (or hold range from) the player; returns the desired velocity. */
  const chaseMove = (a: ActorRef, toPlayer: d.v2f, distP: number) => {
    'use gpu';
    const p = simParams.$;
    let move = d.vec2f();
    if (p.playerAlive === 1 && distP > 1e-3) {
      const spd = speeds.$[a.$.typeId] * p.enemySpeedMul;
      const hold = holdRanges.$[a.$.typeId];
      if (hold > 0) {
        if (distP > hold) {
          move = toPlayer * (spd / distP);
        } else if (distP < hold - 2.5) {
          move = toPlayer * (-0.6 * (spd / distP));
        }
      } else if (distP > a.$.radius + PLAYER.radius + 0.15) {
        move = toPlayer * (spd / distP);
      }
    }
    return move;
  };

  /** Ice spikes chill whoever stands in the lane; Flash Freeze also stuns. */
  const spikeChill = (a: ActorRef) => {
    'use gpu';
    const p = simParams.$;
    const st = p.time - p.spikeStart;
    if (st < 0 || st >= SPIKES.duration * 0.55) return;
    const rel = a.$.pos - p.spikeOrigin;
    const along = std.dot(rel, p.spikeDir);
    const front = std.min(st * SPIKES.speed, SPIKES.range);
    if (along < 0 || along >= front) return;
    const alat = std.abs(lateral(rel, p.spikeDir));
    if (alat < SPIKES.width) {
      a.$.chillT = std.max(a.$.chillT, SPIKES.chillDuration);
      if (a.$.drenchT > 0) {
        a.$.chillT = std.max(a.$.chillT, FREEZE_T + 0.45);
      }
    }
    if (
      keystone(KEYSTONE_BITS.flashFreeze) &&
      alat < SPIKES.width + KEYSTONES.flashFreeze.widthBonus
    ) {
      a.$.chillT = std.max(a.$.chillT, KEYSTONES.flashFreeze.chillDuration);
      a.$.stunT = std.max(a.$.stunT, KEYSTONES.flashFreeze.stunTime);
    }
  };

  /** Deflects `move` around rocks the actor is about to walk into. */
  const steerAroundRocks = (
    a: ActorRef,
    i: number,
    move: d.v2f,
    toPlayer: d.v2f,
    distP: number,
  ) => {
    'use gpu';
    let out = d.vec2f(move);
    for (const k of std.range(N_ROCKS)) {
      const rock = rocks.$[k];
      if (rock.r <= 0.01) continue;
      const rrel = a.$.pos - rock.pos;
      const rd = std.length(rrel);
      const steerR = rock.r + a.$.radius + ROCK_STEER_MARGIN;
      if (rd < steerR && rd > 1e-4) {
        const n = rrel * (1 / rd);
        const into = std.dot(out, n);
        if (into < 0) {
          const tang = perp(n);
          const closing = std.dot(tang, toPlayer);
          let side = std.select(d.f32(-1), d.f32(1), closing >= 0);
          if (std.abs(closing) < 0.3 * distP) {
            side = std.select(d.f32(-1), d.f32(1), d.u32(i) % 2 === 0);
          }
          out = out - n * into + tang * (side * -into);
        }
      }
    }
    return out;
  };

  /** Pushes the actor out of any rock it ended up inside. */
  const resolveRocks = (a: ActorRef) => {
    'use gpu';
    for (const k of std.range(N_ROCKS)) {
      const rock = rocks.$[k];
      if (rock.r <= 0.01) continue;
      const rrel = a.$.pos - rock.pos;
      const rd = std.length(rrel);
      const rr = rock.r + a.$.radius;
      if (rd < rr && rd > 1e-4) {
        a.$.pos = rock.pos + rrel * (rr / rd);
      }
    }
  };

  /**
   * Separation from neighbours via the grid, plus the neighbour-borne
   * keystones: Conduction (shock spreads on contact) and Pyre (burning
   * corpses explode). Returns the separation push; conduction is applied.
   */
  const neighbours = (a: ActorRef, i: number) => {
    'use gpu';
    const p = simParams.$;
    const conduction = keystone(KEYSTONE_BITS.conduction);
    const pyre = keystone(KEYSTONE_BITS.pyre);
    let condShock = d.f32(0);
    let push = d.vec2f();
    const cell = grid.cellOf(a.$.pos);
    for (const dz of std.range(-1, 2)) {
      for (const dx of std.range(-1, 2)) {
        const cx = cell.x + dx;
        const cz = cell.y + dz;
        if (cx < 0 || cx >= SEP_GRID.cells || cz < 0 || cz >= SEP_GRID.cells) continue;
        const cellIdx = cz * SEP_GRID.cells + cx;
        const start = grid.starts.$[cellIdx];
        const end = grid.starts.$[cellIdx + 1];
        for (const k of std.range(MAX_ENEMIES)) {
          if (start + d.u32(k) >= end) break;
          const j = grid.indices.$[start + d.u32(k)];
          if (j === d.u32(i)) continue;
          const o = enemies.$[j];
          if (o.state === STATE.ALIVE) {
            const dvec = a.$.pos - o.pos;
            const rr = a.$.radius + o.radius;
            const dsq = std.dot(dvec, dvec);
            if (dsq < rr * rr && dsq > 1e-6) {
              const dist = std.sqrt(dsq);
              push += dvec * ((rr - dist) / dist);
            }
            if (conduction && o.shockT > KEYSTONES.conduction.threshold) {
              const pad = std.select(
                d.f32(KEYSTONES.conduction.contactPad),
                d.f32(KEYSTONES.conduction.drenchRange),
                a.$.drenchT > 0 && o.drenchT > 0,
              );
              const cr = rr + pad;
              if (dsq < cr * cr) {
                condShock = std.max(condShock, o.shockT);
              }
            }
          } else if (
            pyre &&
            o.state === STATE.DYING &&
            o.burnH > KEYSTONES.pyre.burnThreshold &&
            o.animTime < p.dt * 1.5
          ) {
            const bvec = a.$.pos - o.pos;
            const bd = std.length(bvec);
            if (bd < KEYSTONES.pyre.blastRadius && bd > 1e-4) {
              const falloff = 1 - bd / KEYSTONES.pyre.blastRadius;
              a.$.burnH = std.max(a.$.burnH, KEYSTONES.pyre.igniteBurn * (0.55 + 0.45 * falloff));
              a.$.vel += radialKnock(
                bvec * (1 / bd),
                KEYSTONES.pyre.blastKnock,
                a.$.radius,
                falloff,
              );
              a.$.flash = std.max(a.$.flash, 0.6);
            }
          }
        }
      }
    }
    if (condShock > 0) {
      a.$.shockT = std.max(a.$.shockT, condShock - KEYSTONES.conduction.decay);
      a.$.hp -= p.chainDamage * KEYSTONES.conduction.dpsFactor * p.dt;
    }
    return push;
  };

  /** Picks the locomotion clip and advances animation time with blend bookkeeping. */
  const animate = (a: ActorRef, prev: ActorRef, move: d.v2f, toPlayer: d.v2f, stunned: boolean) => {
    'use gpu';
    const p = simParams.$;
    const boss = isBoss(a);
    const ranged = holdRanges.$[a.$.typeId] > 0;
    const speed = std.length(move);
    let clip = d.u32(CLIP.RUN);
    let rate = animRates.$[a.$.typeId];
    if (stunned || speed < 0.3) {
      clip = d.u32(CLIP.IDLE);
      rate = 1;
    } else if (ranged && std.dot(move, toPlayer) < 0) {
      clip = d.u32(CLIP.WALK);
      rate = 1;
    }
    if (a.$.chillT > 0) {
      rate *= STATUS.chill.animSlow;
    }
    if (a.$.flash > 0.6 && a.$.attackT <= 0 && !boss) {
      clip = d.u32(CLIP.HIT);
      rate = 1.6;
    }
    if (a.$.attackT > 0) {
      clip = prev.$.animClip;
      rate = std.select(a.$.recoverRate, a.$.attackRate, a.$.windupT > 0);
    }
    a.$.animTime = prev.$.animTime + p.dt * rate;
    a.$.blendT = std.max(0, prev.$.blendT - p.dt);
    if (clip !== prev.$.animClip) {
      a.$.animTime = 0;
      a.$.prevClip = prev.$.animClip;
      a.$.prevTime = prev.$.animTime;
      a.$.blendT = BLEND_DUR;
    }
    a.$.animClip = clip;
    if (a.$.chillT > FREEZE_T) {
      a.$.animClip = prev.$.animClip;
      a.$.animTime = prev.$.animTime;
      a.$.blendT = prev.$.blendT;
    }
  };

  /** Faces the move direction, or the player when ranged or standing still. */
  const turnToward = (a: ActorRef, move: d.v2f, toPlayer: d.v2f, distP: number) => {
    'use gpu';
    const ranged = holdRanges.$[a.$.typeId] > 0;
    let facing = d.vec2f(move);
    if ((ranged || std.length(move) < 0.3) && distP > 1e-3) {
      facing = d.vec2f(toPlayer);
    }
    if (std.length(facing) > 1e-3 && (a.$.attackT <= 0 || ranged)) {
      const target = std.atan2(facing.x, facing.y);
      const diff = std.atan2(std.sin(target - a.$.heading), std.cos(target - a.$.heading));
      a.$.heading += diff * std.min(1, 9 * simParams.$.dt);
    }
  };

  // ---- Per-actor kernel ---------------------------------------------------

  /** Spawn-in: play the emerge clip, then hand over to the run loop. */
  const tickSpawning = (a: ActorRef, flash: number) => {
    'use gpu';
    const p = simParams.$;
    const t = a.$.animTime + p.dt;
    a.$.flash = flash;
    if (t >= SPAWN_DUR) {
      a.$.vel = d.vec2f();
      a.$.state = STATE.ALIVE;
      a.$.animClip = CLIP.RUN;
      a.$.animTime = std.fract(a.$.pos.x * 7.31 + a.$.pos.y * 3.17) * 2;
      a.$.prevClip = CLIP.SPAWN;
      a.$.prevTime = t;
      a.$.blendT = BLEND_DUR;
      a.$.stunT = 0;
    } else {
      a.$.animTime = t;
    }
  };

  /** Dying: play the death clip out and let a burning corpse smoulder. */
  const tickDying = (a: ActorRef, flash: number) => {
    'use gpu';
    const p = simParams.$;
    if (a.$.animClip !== CLIP.DEATH) {
      a.$.animClip = CLIP.DEATH;
      a.$.animTime = 0;
      a.$.attackT = 0;
      a.$.windupT = 0;
      a.$.dashT = 0;
    } else {
      a.$.animTime += p.dt;
    }
    a.$.blendT = std.max(0, a.$.blendT - p.dt);
    a.$.flash = flash;
    a.$.burnH = std.max(0, a.$.burnH - p.dt * BURN_DECAY);
    if (a.$.burnH > 0.2 && randf.sample() < p.dt * STATUS.burn.flameRate * a.$.burnH * 0.5) {
      emitters.emitActorFlame(a.$.pos, a.$.burnH * 0.7);
    }
  };

  const tickAlive = (a: ActorRef, prev: ActorRef, i: number, flash: number) => {
    'use gpu';
    const p = simParams.$;
    const boss = isBoss(a);
    a.$.flash = flash;
    a.$.stunT = std.max(0, a.$.stunT - p.dt);
    a.$.attackT = std.max(0, a.$.attackT - p.dt);
    a.$.windupT = std.max(0, a.$.windupT - p.dt);
    a.$.dashT = std.max(0, a.$.dashT - p.dt);
    a.$.poisonT = std.max(0, a.$.poisonT - p.dt);
    a.$.chillT = std.max(0, a.$.chillT - p.dt);
    a.$.shockT = std.max(0, a.$.shockT - p.dt);
    a.$.burnH = std.max(0, a.$.burnH - p.dt * BURN_DECAY);
    a.$.drenchT = std.max(0, a.$.drenchT - p.dt);
    if (boss) {
      a.$.stunT = std.min(a.$.stunT, BOSS.stunCap);
      a.$.chillT = std.min(a.$.chillT, BOSS.chillCap);
    }

    if (p.attackDamage > 0) playerMelee(a);
    if (keystone(KEYSTONE_BITS.crescent) && a.$.hp > 0) crescentWaves(a, prev.$.vel);
    if (p.meteorDamage > 0 && a.$.hp > 0) meteorBlast(a);
    if (p.shockStart >= 0 && a.$.hp > 0) novaRing(a);
    if (p.spikeStart >= 0 && a.$.hp > 0) spikeLane(a);
    if (a.$.hp > 0) fireField(a);
    if (a.$.hp > 0) waterField(a);
    if (p.wellDetonate > 0 && a.$.hp > 0) wellDetonation(a);
    if (p.bladeCount > 0 && a.$.hp > 0) orbitingBlades(a);
    if (a.$.hp > 0) volleyArrows(a);
    if (a.$.poisonT > 0 && a.$.hp > 0) a.$.hp -= p.poisonDps * p.dt;
    if (a.$.burnH > 0 && a.$.hp > 0) a.$.hp -= p.fireDps * a.$.burnH * p.dt;
    if (a.$.hp <= 0) {
      kill(a);
      return;
    }

    statusParticles(a);
    if (p.wellStart >= 0) wellPull(a);

    const toPlayer = p.playerPos - a.$.pos;
    const distP = std.length(toPlayer);
    let move = chaseMove(a, toPlayer, distP);

    if (p.spikeStart >= 0) spikeChill(a);
    if (prev.$.chillT > FREEZE_T && a.$.chillT <= FREEZE_T) {
      for (const _ of std.range(4)) {
        emitters.emitChillMist(a.$.pos);
      }
      emitters.emitIceBurst(a.$.pos, randf.inUnitCircle());
    }
    if (a.$.chillT > 0) {
      move = move * std.select(d.f32(SPIKES.slowFactor), d.f32(BOSS.chillSlowFactor), boss);
    }
    if (a.$.drenchT > 0) {
      move =
        move * std.select(d.f32(WATER.drenchSlowFactor), d.f32(WATER.bossDrenchSlowFactor), boss);
    }

    const rocksSolid = distP < ROCK_IGNORE_BEYOND;
    if (rocksSolid) {
      move = steerAroundRocks(a, i, move, toPlayer, distP);
    }
    const stunned = a.$.stunT > 0;
    if (stunned || a.$.attackT > 0) {
      move = d.vec2f();
    }
    if (a.$.dashT > 0) {
      move = headingDir(a.$.heading) * a.$.dashSpeed;
    }

    let push = neighbours(a, i);
    if (a.$.hp <= 0) {
      kill(a);
      return;
    }
    const dvp = a.$.pos - p.playerPos;
    const rrp = a.$.radius + PLAYER.radius;
    const dsqp = std.dot(dvp, dvp);
    if (p.playerAlive === 1 && dsqp < rrp * rrp && dsqp > 1e-6) {
      const dist = std.sqrt(dsqp);
      push += dvp * ((rrp - dist) / dist) * 2;
    }

    if (boss) {
      a.$.vel = prev.$.vel + (a.$.vel - prev.$.vel) * BOSS.knockFactor;
    }
    a.$.pos += (move + a.$.vel) * p.dt + push * std.min(0.5, 6 * p.dt);
    a.$.vel = a.$.vel * std.exp(-6 * p.dt);
    const ring = std.length(a.$.pos);
    if (ring > ARENA_RADIUS) {
      a.$.pos = a.$.pos * (ARENA_RADIUS / ring);
    }
    if (rocksSolid) resolveRocks(a);

    turnToward(a, move, toPlayer, distP);
    animate(a, prev, move, toPlayer, stunned);
  };

  const enemyKernel = createKernel(gpu, [MAX_ENEMIES], (i: number) => {
    'use gpu';
    const p = simParams.$;
    const prev = enemies.$[i];
    if (prev.state === STATE.DEAD) {
      return;
    }
    randf.seed2(
      d.vec2f(
        std.fract(prev.pos.x * 0.371 + p.time * 0.173) + d.f32(i) * 0.00021,
        std.fract(prev.pos.y * 0.293 + p.time * 0.101),
      ),
    );
    const flash = std.max(0, prev.flash - 3.5 * p.dt);
    let a = std.copy(prev);
    if (prev.state === STATE.SPAWNING) {
      tickSpawning(d.ref(a), flash);
    } else if (prev.state === STATE.DYING) {
      tickDying(d.ref(a), flash);
    } else {
      tickAlive(d.ref(a), d.ref(prev), i, flash);
    }
    enemies.$[i] = std.copy(a);
  });

  // ---- Chain lightning ----------------------------------------------------

  /** Greedy nearest-unvisited hop from the player, damaging and stunning each node. */
  const chainKernel = createKernel(gpu, [1], () => {
    'use gpu';
    const p = simParams.$;
    randf.seed2(d.vec2f(std.fract(p.time * 0.317), std.fract(p.time * 0.731)));
    const visited = d.arrayOf(d.u32, CHAIN.maxNodes)();
    let current = d.vec2f(p.playerPos);
    let count = d.u32(1);
    chain.$.nodes[0] = d.vec2f(current);

    for (const hop of std.range(1, CHAIN.maxNodes)) {
      let best = d.i32(-1);
      let bestD = d.f32(CHAIN.range);
      for (const j of std.range(MAX_ENEMIES)) {
        const o = enemies.$[j];
        if (o.state !== STATE.ALIVE) continue;
        let seen = false;
        for (const v of std.range(CHAIN.maxNodes)) {
          if (visited[v] === d.u32(j) + 1) {
            seen = true;
          }
        }
        if (seen) continue;
        const dist = std.distance(o.pos, current);
        if (dist < bestD) {
          bestD = dist;
          best = d.i32(j);
        }
      }
      if (best < 0) break;
      const idx = d.u32(best);
      visited[hop] = idx + 1;
      let target = std.copy(enemies.$[idx]);
      chain.$.nodes[hop] = d.vec2f(target.pos);
      count = d.u32(hop) + 1;

      emitters.emitChainBurst(target.pos);
      const dmg =
        p.chainDamage * std.select(d.f32(1), d.f32(WATER.comboChainMult), target.drenchT > 0);
      if (target.hp - dmg <= 0) {
        kill(d.ref(target));
      } else {
        target.hp -= dmg;
        target.flash = 1;
        target.stunT = CHAIN.stunTime;
        target.shockT = CHAIN.stunTime;
        target.vel += randf.inUnitCircle() * 3;
      }
      current = d.vec2f(target.pos);
      enemies.$[idx] = std.copy(target);
    }
    chain.$.count = count;
    chain.$.time = p.time;
  });

  /** Compact per-actor snapshot the CPU reads back for hit/kill bookkeeping. */
  const snapshotKernel = createKernel(gpu, [MAX_ENEMIES], (i: number) => {
    'use gpu';
    const e = enemies.$[i];
    const frozen = std.select(d.f32(0), d.f32(1), e.chillT > FREEZE_T);
    snaps.$[i] = ActorSnap({
      pos: d.vec2f(e.pos),
      heading: e.heading,
      state: e.state,
      flags: e.flags,
      hp: e.hp,
      stun: std.max(e.stunT, frozen),
    });
  });

  // ---- CPU API ------------------------------------------------------------

  let chainQueued = false;
  let simTime = 0;
  let fireActiveUntil = -1;
  let waterActiveUntil = -1;
  let fieldDirty = false;
  const volleyScratch: VolleyArrowSpec[] = Array.from({ length: MAX_VOLLEY }, () => IDLE_VOLLEY);

  const writeDynamicRocks = (dynamicRocks: readonly RockCollider[]) => {
    for (let i = 0; i < MAX_SPIKE_ROCKS; i++) {
      const r = dynamicRocks[i];
      const slot = rockScratch[N_STATIC_ROCKS + i];
      slot.pos = [r?.x ?? 0, r?.z ?? 0];
      slot.r = r?.r ?? 0;
    }
    rocks.write(rockScratch);
  };

  return {
    params,
    trampleBuf: trample.trampleBuf,
    fieldTex,
    chainBuf,
    volleyBuf,
    actorSnapBuf: snapBuf,
    queueChain() {
      chainQueued = true;
    },
    igniteFire(px, pz, dx, dz) {
      fireActiveUntil = simTime + FIRE.maxBurnWindow;
      fire.ignite(px, pz, dx, dz);
    },
    igniteAt(px, pz, r, heatFrac) {
      fireActiveUntil = simTime + FIRE.maxBurnWindow;
      fire.igniteAt(px, pz, r, heatFrac);
    },
    fireActive: () => simTime < fireActiveUntil,
    fieldDirtyThisFrame: () => fieldDirty,
    surgeWater(px, pz, dx, dz, power, riptide) {
      const fresh = simTime >= waterActiveUntil;
      waterActiveUntil = simTime + WATER.maxSurgeWindow;
      const pump = riptide ? KEYSTONES.undertow.riptideTime : WATER.torrentTime;
      const waves = riptide ? WATER.floodWaves : WATER.baseWaves;
      const crestScale = riptide ? WATER.floodCrestScale : WATER.baseCrestScale;
      water.surge(px, pz, dx, dz, power, simTime, simTime + pump, fresh, waves, crestScale);
    },
    waterActive: () => simTime < waterActiveUntil,
    castVolley(arrows) {
      for (let i = 0; i < MAX_VOLLEY; i++) volleyScratch[i] = arrows[i] ?? IDLE_VOLLEY;
      volleyBuf.write(volleyScratch);
    },
    castCrescent(origin, dir, start, damage, kind) {
      const w = crescentScratch[crescentSlot];
      crescentSlot = (crescentSlot + 1) % MAX_CRESCENT;
      w.origin = origin;
      w.dir = dir;
      w.start = start;
      w.damage = damage;
      w.kind = kind;
      crescentBuf.write(crescentScratch);
    },
    setParticleDensity: emitters.setDensity,
    setDynamicRocks: writeDynamicRocks,
    run(dt, enc) {
      simTime += dt;
      emitters.beginFrame(enc);
      grid.run(enc);
      enemyKernel.run(enc);
      if (chainQueued) {
        chainQueued = false;
        chainKernel.run(enc);
      }
      snapshotKernel.run(enc);
      trample.run(enc);
      const fireDirty = fire.run(dt, simTime < fireActiveUntil, enc);
      const waterDirty = water.run(dt, simTime < waterActiveUntil, enc);
      fieldDirty = fireDirty || waterDirty;
      if (fieldDirty) fieldTex.run(enc);
    },
    reset() {
      const dead = makeActor();
      enemyBuf.write(Array.from({ length: MAX_ENEMIES }, () => dead));
      chainBuf.write({
        count: 0,
        time: -100,
        nodes: Array.from({ length: CHAIN.maxNodes }, () => [0, 0]),
      });
      for (let i = 0; i < MAX_VOLLEY; i++) volleyScratch[i] = IDLE_VOLLEY;
      volleyBuf.write(volleyScratch);
      for (const w of crescentScratch) {
        w.start = -100;
        w.damage = 0;
      }
      crescentSlot = 0;
      crescentBuf.write(crescentScratch);
      writeDynamicRocks([]);
      chainQueued = false;
      fireActiveUntil = -1;
      waterActiveUntil = -1;
      trample.reset();
      fire.reset();
      water.reset();
      emitters.reset();
    },
  };
}
