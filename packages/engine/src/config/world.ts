import { rgb } from './types.ts';

export const ARENA_RADIUS = 34;
export const SPAWN_RADIUS = 31;

export const MAX_PARTICLES = 20480;
export const GPU_PARTICLES = 15360;

export const PARTICLE_DENSITY = {
  tiers: { reduced: 0.4, normal: 0.7, full: 1.0 } as const,
  essentialFloor: 0.7,
  compactBlock: 64,
};
export type ParticleDensity = (typeof PARTICLE_DENSITY.tiers)[keyof typeof PARTICLE_DENSITY.tiers];

export const TRAMPLE_CELLS = 128;
export const TRAMPLE_HALF = 36;

export const SEP_GRID = { cells: 36, half: 36 };

export const AMBIENT = {
  torchColor: rgb(1.5, 1.05, 0.5),
  torchRadius: 10,
  torchThreshold: 0.05,
  leafInterval: 0.22,
  leafJitter: 0.2,
};

export const AUDIO = {
  refDistance: 11,
  maxDistance: 46,
  panScale: 18,
  panMax: 0.7,
  musicFade: 1.6,
  musicStopFade: 3,
  duckFade: 0.35,
  loopFade: 0.4,
  duckLevel: { playing: 1, menu: 0.35, dead: 0.3, frozen: 0 },
  ambienceGain: 0.55,
  hordeMin: 6,
  hordeFull: 40,
  heartbeatBelow: 0.3,
};

export const HAPTICS = {
  maxDistance: 14,
  minInterval: 0.09,
  minGap: 0.05,
};

export const HAZE = {
  heatAmp: 0.006,
  shockAmp: 0.011,
  lensRadius: 0.24,
  lensAmp: 0.5,
  swirl: 0.8,
};

export const RAYS = {
  steps: 16,
  maxDist: 48,
  scaleHeight: 7,
  density: 0.02,
  baseScatter: 0.5,
  forwardScatter: 0.75,
};

export const CLOUDS = {
  scale: 0.045,
  windX: 0.07,
  windZ: 0.04,
  coverage: 0.05,
  softness: 0.3,
  strength: 0.65,
  nightFade: 0.85,
  bakeInterval: 4,
};

export const HUD_CHROME = {
  snapshotHz: 15,
};

export const PACING = {
  valveMs: 17,
  skip: 1,
};

export const READBACK = {
  hz: 30,
};

export const DEBUG = {
  startWave: 1,
  abilityPoints: 0,
};

export const FOLIAGE = {
  grassCount: 20000,
  grassClearance: { tree: 0.2, deadTree: 0.25, rock: 0.85, bush: 0.55 },
  grassMaxAttempts: 4,
  playerBend: 9,
  playerRadius: 1.4,
  trampleBend: 4.5,
  meteorBend: 22,
  novaBend: 16,
  wellBend: 10,
  floodSubmerge: 0.85,
  floodSubmergeMax: 0.9,
  maxBendPerHeight: 0.4,
};
