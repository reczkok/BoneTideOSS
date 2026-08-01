import { rgb } from './types.ts';

export const REVEAL = {
  duration: 3.4,
  fogNearFrom: -6,
  fogFarFrom: 3,
  fogNearTo: 42,
  fogFarTo: 110,
  veilEnd: 0.4,
};

export const TELEGRAPH = {
  max: 16,
  appear: 0.12,
  base: 0.45,
  linger: 0.08,
  lineWidth: 0.16,
  fill: 0.12,
  edgeWobble: 0.16,
  flicker: 0.3,
  emberFloor: 0.18,
  arcFeather: 0.18,
  color: rgb(1.85, 0.58, 0.19),
  showSlackFrac: 0.5,
  bodyRamp: 0.45,
  bodyRim: rgb(1.6, 0.45, 0.14),
  bodyRimExp: 3.0,
  bodyStrength: 0.55,
  whooshMinWindup: 0.45,
  whooshGain: 0.4,
  whooshRate: 0.75,
};

export const ORBS = {
  maxFps: 30,
  ringInner: 0.84,
  waveAmp: 0.028,
  waveAmp2: 0.016,
  noiseAmp: 0.05,
  lowPulseBelow: 0.32,
  surgeDecay: 2.4,
  hp: {
    deep: rgb(0.34, 0.015, 0.02),
    bright: rgb(0.95, 0.22, 0.1),
  },
  xp: {
    deep: rgb(0.16, 0.06, 0.32),
    bright: rgb(0.66, 0.45, 1.0),
  },
};

export const DPR = {
  canvasCap: 1.75,
  vitalsCap: 3,
};
