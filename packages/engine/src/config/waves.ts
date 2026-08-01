import { rgb } from './types.ts';

export const DAYCYCLE = {
  wavesPerDay: 5,
  startPhase: 0.42,
  lapse: { duration: 5 },
};

export const isNightWave = (n: number) =>
  n % DAYCYCLE.wavesPerDay === 1 || n % DAYCYCLE.wavesPerDay === 2;

export const isBossWave = (n: number) => n >= 10 && n % DAYCYCLE.wavesPerDay === 0;

export const NIGHT = {
  minionFactor: 0.6,
  extraRogues: (n: number) => 4 + n,
  extraMages: (n: number) => (n >= 3 ? 2 + (n >> 1) : 0),
  eliteMult: 1.5,
  necromancers: (n: number) => (n >= 6 ? Math.min(3, 1 + Math.floor((n - 6) / 10)) : 0),
};

export const BLOODMOON = {
  easeIn: 2.0,
  easeOut: 3.0,
  sunColor: rgb(0.62, 0.08, 0.06),
  ambientSky: rgb(0.11, 0.03, 0.04),
  ambientGround: rgb(0.05, 0.02, 0.02),
  fogColor: rgb(0.17, 0.03, 0.04),
  nightFactor: 0.85,
  pulseAmp: 0.08,
  pulsePeriod: 4.5,
};

export const WAVES = {
  pregameDelay: 3.0,
  intermission: 4.5,
  clearHeal: 18,
  burstInterval: (n: number) => Math.max(0.9, 1.8 - n * 0.08),
  burstSize: (n: number) => 4 + n,
  hpScale: (n: number) => 1 + n * 0.06,
  dmgScale: (n: number) => 1 + n * 0.045,
  speedScale: (n: number) => Math.min(1 + n * 0.01, 1.18),
  clearDebounce: 0.4,
};

export type Difficulty = 'easy' | 'normal' | 'hard';

export const DIFFICULTY: Record<
  Difficulty,
  {
    enemySpeed: number;
    boltSpeed: number;
    enemyDamage: number;
    enemyHp: number;
    regenHpPerSec: number;
  }
> = {
  easy: { enemySpeed: 0.85, boltSpeed: 0.8, enemyDamage: 0.7, enemyHp: 0.85, regenHpPerSec: 1 },
  normal: { enemySpeed: 0.93, boltSpeed: 0.9, enemyDamage: 0.85, enemyHp: 0.92, regenHpPerSec: 0 },
  hard: { enemySpeed: 1, boltSpeed: 1, enemyDamage: 1, enemyHp: 1, regenHpPerSec: 0 },
};

export function waveComposition(n: number): [number, number][] {
  const night = isNightWave(n);
  const comp: [number, number][] = [
    [0, Math.round((8 + n * 5) * (night ? NIGHT.minionFactor : 1))],
  ];
  if (n >= 2) comp.push([1, 3 * (n - 1) + (night ? NIGHT.extraRogues(n) : 0)]);
  if (n >= 3) comp.push([2, Math.min(1 + (n - 2), 40)]);
  if (n >= 5 || (night && NIGHT.extraMages(n) > 0)) {
    comp.push([3, (n >= 5 ? Math.min(2 + (n - 4), 40) : 0) + (night ? NIGHT.extraMages(n) : 0)]);
  }
  if (n >= 4) comp.push([4, Math.min(1 + ((n - 4) >> 1), 8)]);
  if (isBossWave(n)) comp.push([5, n >= 20 ? 2 : 1]);
  if (night && NIGHT.necromancers(n) > 0) comp.push([6, NIGHT.necromancers(n)]);
  if (n >= 5) comp.push([7, Math.min(2 + ((n - 5) >> 1), 20)]);
  return comp;
}
