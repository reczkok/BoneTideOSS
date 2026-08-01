import { d, type StorageFlag, type TgpuBuffer } from 'typegpu';
import { CHAIN } from '../config.ts';

export const Actor = d.struct({
  pos: d.vec2f,
  vel: d.vec2f,
  heading: d.f32,
  legYaw: d.f32,
  hp: d.f32,
  state: d.u32,
  typeId: d.u32,
  animClip: d.u32,
  animTime: d.f32,
  attackT: d.f32,
  attackRate: d.f32,
  recoverRate: d.f32,
  windupT: d.f32,
  dashT: d.f32,
  dashSpeed: d.f32,
  lowerClip: d.u32,
  lowerTime: d.f32,
  flash: d.f32,
  stunT: d.f32,
  radius: d.f32,
  scale: d.f32,
  flags: d.u32,
  poisonT: d.f32,
  chillT: d.f32,
  shockT: d.f32,
  burnH: d.f32,
  drenchT: d.f32,
  prevClip: d.u32,
  prevTime: d.f32,
  blendT: d.f32,
});

export const ACTOR_FLAGS = {
  ELITE: 1,
  BOSS: 2,
  LAYERED: 4,
  BLEND_UPPER: 8,
} as const;

export const ActorSnap = d.struct({
  pos: d.vec2f,
  heading: d.f32,
  state: d.u32,
  flags: d.u32,
  hp: d.f32,
  stun: d.f32,
});

export const STATE = { DEAD: 0, SPAWNING: 1, ALIVE: 2, DYING: 3 } as const;

type AsTuple<V> = V extends d.v2f
  ? [number, number]
  : V extends d.v3f
    ? [number, number, number]
    : V extends d.v4f
      ? [number, number, number, number]
      : V;

/**
 * Mutable CPU mirror of a struct schema: vectors become plain tuples (no
 * allocation on write, mutable in place), everything else keeps its type.
 * Assignable to `d.InferInput<S>`, so it goes straight into `.write()`.
 */
export type CpuRecord<S> = { -readonly [K in keyof d.InferGPU<S>]: AsTuple<d.InferGPU<S>[K]> };

/** CPU record for one actor slot, as accepted by `ActorBuffer.write`/`patch`. */
export type ActorRecord = CpuRecord<typeof Actor>;

export function makeActor(overrides: Partial<ActorRecord> = {}): ActorRecord {
  return {
    pos: [0, 0],
    vel: [0, 0],
    heading: 0,
    legYaw: 0,
    hp: 0,
    state: STATE.DEAD,
    typeId: 0,
    animClip: 0,
    animTime: 0,
    attackT: 0,
    attackRate: 1,
    recoverRate: 1,
    windupT: 0,
    dashT: 0,
    dashSpeed: 0,
    lowerClip: 0,
    lowerTime: 0,
    flash: 0,
    stunT: 0,
    radius: 0,
    scale: 1,
    flags: 0,
    poisonT: 0,
    chillT: 0,
    shockT: 0,
    burnH: 0,
    drenchT: 0,
    prevClip: 0,
    prevTime: 0,
    blendT: 0,
    ...overrides,
  };
}

export const JOINTS = 23;

export const Lighting = d.struct({
  sunDir: d.vec3f,
  sunColor: d.vec3f,
  ambientSky: d.vec3f,
  ambientGround: d.vec3f,
  fogColor: d.vec3f,
  nightFactor: d.f32,
  fireOn: d.u32,
  waterOn: d.u32,
});

export const MAX_POINT_LIGHTS = 16;

export const PointLight = d.struct({
  pos: d.vec3f,
  color: d.vec3f,
  radius: d.f32,
});

export const CameraData = d.struct({
  viewProj: d.mat4x4f,
  invViewProj: d.mat4x4f,
  camPos: d.vec3f,
  time: d.f32,
  camRight: d.vec3f,
  camUp: d.vec3f,
});

/** Billboard looks, stored as a float in `Particle.shape`. */
export const SHAPE = {
  SPARK: 0,
  STAR: 1,
  RING: 2,
  BUBBLE: 3,
  RIPPLE: 4,
  VAPOR: 5,
  STEAM: 6,
} as const;

export const Particle = d.struct({
  pos: d.vec3f,
  vel: d.vec3f,
  color: d.vec3f,
  life: d.f32,
  maxLife: d.f32,
  size: d.f32,
  gravity: d.f32,
  bounce: d.f32,
  stretch: d.f32,
  glow: d.f32,
  home: d.f32,
  shape: d.f32,
});

export const FIREFLY_COUNT = 380;
export const Firefly = d.struct({
  pos: d.vec3f,
  home: d.vec2f,
  phase: d.f32,
  zapT: d.f32,
});

export const ChainState = d.struct({
  count: d.u32,
  time: d.f32,
  nodes: d.arrayOf(d.vec2f, CHAIN.maxNodes),
});

export const SimParams = d.struct({
  playerPos: d.vec2f,
  attackOrigin: d.vec2f,
  attackDir: d.vec2f,
  shockOrigin: d.vec2f,
  meteorPos: d.vec2f,
  shockStart: d.f32,
  meteorDamage: d.f32,
  meteorRadius: d.f32,
  dt: d.f32,
  time: d.f32,
  attackDamage: d.f32,
  attackRange: d.f32,
  attackArcCos: d.f32,
  attackKnock: d.f32,
  wellPos: d.vec2f,
  wellStart: d.f32,
  wellDetonate: d.f32,
  spikeOrigin: d.vec2f,
  spikeDir: d.vec2f,
  spikeStart: d.f32,
  spikeDamage: d.f32,
  fireDps: d.f32,
  poisonDps: d.f32,
  waterZapStart: d.f32,
  waterZapDps: d.f32,
  novaDamage: d.f32,
  chainDamage: d.f32,
  bladeDps: d.f32,
  bladeOrbit: d.f32,
  bladeCount: d.u32,
  keystoneBits: d.u32,
  playerAlive: d.u32,
  enemySpeedMul: d.f32,
});

export const KEYSTONE_BITS = {
  toxicWake: 1,
  conduction: 2,
  pyre: 4,
  flashFreeze: 8,
  crescent: 16,
  singularity: 32,
  undertow: 64,
  meteorShower: 0,
} as const;

export type KeystoneId = keyof typeof KEYSTONE_BITS;

export const VolleyArrow = d.struct({
  origin: d.vec2f,
  dir: d.vec2f,
  start: d.f32,
  damage: d.size(12, d.f32),
});

export const CrescentWave = d.struct({
  origin: d.vec2f,
  dir: d.vec2f,
  start: d.f32,
  damage: d.f32,
  kind: d.size(8, d.f32),
});

export const TelegraphEntry = d.struct({
  pos: d.vec2f,
  dir: d.vec2f,
  radius: d.f32,
  halfArc: d.f32,
  t0: d.f32,
  t1: d.f32,
  kind: d.f32,
  cosHalf: d.f32,
  cosFeatherIn: d.f32,
  boundSq: d.f32,
});

export type TelegraphRecord = CpuRecord<typeof TelegraphEntry>;

export const FxData = d.struct({
  playerPos: d.vec2f,
  shockOrigin: d.vec2f,
  meteorPos: d.vec2f,
  wellPos: d.vec2f,
  spikeOrigin: d.vec2f,
  spikeDir: d.vec2f,
  shockStart: d.f32,
  meteorImpact: d.f32,
  chainStart: d.f32,
  wellStart: d.f32,
  spikeStart: d.f32,
  firePos: d.vec2f,
  fireStart: d.f32,
  swingDir: d.vec2f,
  swingStart: d.f32,
  swingArc: d.f32,
  swingSign: d.f32,
  waterZapStart: d.f32,
});

export const SkinnedDeformVertex = d.unstruct({
  position: d.float32x3,
  joints: d.uint8x4,
  weights: d.unorm16x4,
});

export const SkinnedShadeVertex = d.unstruct({
  normal: d.snorm16x4,
  uv: d.unorm16x2,
});

export const PropVertex = d.unstruct({
  position: d.float32x3,
  normal: d.snorm16x4,
  uv: d.unorm16x2,
});

export const PropInstance = d.struct({
  pos: d.vec3f,
  rotCS: d.vec2f,
  scale: d.f32,
  sway: d.f32,
});

export type ActorBuffer = TgpuBuffer<d.WgslArray<typeof Actor>> & StorageFlag;
export type ActorSnapBuffer = TgpuBuffer<d.WgslArray<typeof ActorSnap>> & StorageFlag;
export type ParticleBuffer = TgpuBuffer<d.WgslArray<typeof Particle>> & StorageFlag;
export type TrampleBuffer = TgpuBuffer<d.WgslArray<d.I32>> & StorageFlag;
export type FieldBuffer = TgpuBuffer<d.WgslArray<d.I32>> & StorageFlag;
export type ChainBuffer = TgpuBuffer<typeof ChainState> & StorageFlag;
export type VolleyBuffer = TgpuBuffer<d.WgslArray<typeof VolleyArrow>> & StorageFlag;
