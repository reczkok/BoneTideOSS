import { isNightWave, NIGHT } from './waves.ts';
import { rgb, vec2 } from './types.ts';

export const PROGRESS = {
  xpForLevel: (level: number) => Math.round(30 + (level - 1) * 26 + (level - 1) ** 2 * 4),
};

export const SLOT_CODES = ['KeyE', 'KeyR', 'KeyF', 'KeyG', 'KeyV'] as const;
export const SLOT_LABELS = SLOT_CODES.map((c) => c.slice(3));
export const SLOT_COUNT = SLOT_CODES.length;

export const TREE_NAV = {
  coneRatio: 1.5,
  perpWeight: 2,
  edgeInset: 0.15,
  flyMs: 250,
};

export const MAGEBOLT = {
  damage: 13,
  cooldown: 2.9,
  fireRange: 15,
  castWindup: 0.35,
  muzzleForward: 0.95,
  muzzleRight: -0.22,
  flightSpeed: 10,
  arcHeight: 3.2,
  launchHeight: 1.6,
  radius: 1.6,
  heat: 0.3,
  shake: 0.12,
  maxInFlight: 24,
};

export const ARROW = {
  speed: 16,
  damage: 10,
  range: 18,
  cooldown: 3.4,
  fireRange: 14,
  hitRadius: 0.45,
  windup: 0.45,
  telegraphLen: 11,
  telegraphWidth: 0.4,
  height: 1.0,
  muzzleForward: 0.8,
  maxInFlight: 48,
  scaleMul: 1.0,
};

export const BOSS = {
  name: 'BLOODMOON GOLEM',
  stunCap: 0.35,
  chillCap: 1.2,
  chillSlowFactor: 0.78,
  knockFactor: 0.06,
  slam: {
    range: 8,
    radius: 7,
    damage: 40,
    windup: 0.8,
    cooldown: 2.8,
    shake: 0.55,
    followThrough: 0.5,
  },
  charge: {
    minRange: 7,
    maxRange: 18,
    windup: 0.9,
    chainWindup: 0.55,
    speed: 16,
    runRate: 2.0,
    width: 1.8,
    damage: 55,
    overshoot: 4,
    staggerT: 1.3,
    cooldown: 6.5,
    shake: 0.35,
    windupClipFrac: 0.5,
  },
  boulder: {
    minRange: 12,
    windup: 0.7,
    flightSpeed: 13,
    damage: 32,
    radius: 3.2,
    arcHeight: 6,
    launchHeight: 3.2,
    cooldown: 5.5,
    volleySpacing: 0.35,
    heat: 0.35,
    shake: 0.3,
    maxInFlight: 8,
    rockScale: 1.2,
    rockSpin: 4.5,
    glow: { color: rgb(2.6, 0.9, 0.35), radius: 8 },
  },
  phases: {
    thresholds: vec2(0.6, 0.3),
    windupMul: [1, 0.85, 0.72],
    cooldownMul: [1, 0.85, 0.7],
    chargeChain: [1, 2, 2],
    boulderCount: [1, 2, 2],
    slamRadiusMul: [1, 1, 1.12],
    transition: { holdT: 1.0, shake: 0.5 },
  },
  step: { period: 0.55, shake: 0.12, shakeRange: 26 },
  aura: {
    lightColor: rgb(2.8, 0.5, 0.25),
    lightRadius: 13,
    lightHeight: 2.2,
    pulseSpeed: 2.2,
    pulseDepth: 0.3,
    rimColor: rgb(1.8, 0.2, 0.12),
    rimExponent: 2.5,
    rimStrength: 0.6,
  },
  ultCharge: 0.5,
  potionDrops: 3,
};

export const NECRO_GLOW = {
  color: rgb(0.85, 0.55, 1.5),
  radius: 6.5,
  height: 1.6,
  threshold: 0.05,
  summonLight: {
    color: rgb(2.0, 1.1, 3.4),
    radius: 9,
    height: 1.2,
    life: 0.6,
  },
};

export const STRIKE = {
  followThrough: 0.35,
  impact: {
    punch: 0.42,
    chop: 0.57,
    smash: 0.4,
    throw: 0.54,
    stab: 0.27,
    slice: 0.21,
    shoot: 0.31,
    bash: 0.25,
  },
  hitSlack: 0.5,
  cancelStun: 0.1,
  cancelRetry: 0.6,
  heatPerDamage: 0.03,
  shake: 0.12,
};

export const ELITES = {
  fromWave: 3,
  chance: (n: number) =>
    Math.min(0.04 + 0.012 * (n - 3), 0.3) * (isNightWave(n) ? NIGHT.eliteMult : 1),
  hpMult: 3,
  xpMult: 4,
  scale: 1.35,
  radiusMult: 1.25,
};

export const POTIONS = {
  dropChance: 0.045,
  nightBonus: 1.6,
  heal: 22,
  lifetime: 25,
  pickupRadius: 1.1,
};

export const ROCK_STEER_MARGIN = 1.5;

export const ROCK_IGNORE_BEYOND = 27;

export const ARENA_ROCKS: { x: number; z: number; r: number }[] = [
  { x: 10, z: -7, r: 1.6 },
  { x: -12, z: 5, r: 1.8 },
  { x: 4, z: 14, r: 1.5 },
  { x: -6, z: -15, r: 1.7 },
  { x: 16, z: 9, r: 1.4 },
];
