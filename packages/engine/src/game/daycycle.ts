import { DAYCYCLE, type Rgb } from '../config.ts';
import { lerp, smooth01 } from '../core/mathx.ts';
import type { LightingValues } from '../renderer/env.ts';

interface Key {
  at: number;
  elev: number;
  azim: number;
  sun: Rgb;
  sky: Rgb;
  ground: Rgb;
  fog: Rgb;
  night: number;
}

const KEYS: Key[] = [
  {
    at: 0.0,
    elev: 25,
    azim: 20,
    sun: [1.2, 0.92, 0.6],
    sky: [0.4, 0.47, 0.57],
    ground: [0.25, 0.27, 0.19],
    fog: [0.66, 0.72, 0.62],
    night: 0,
  },
  {
    at: 0.18,
    elev: 50,
    azim: 60,
    sun: [1.36, 1.15, 0.8],
    sky: [0.4, 0.5, 0.63],
    ground: [0.26, 0.3, 0.19],
    fog: [0.56, 0.74, 0.66],
    night: 0,
  },
  {
    at: 0.36,
    elev: 40,
    azim: 110,
    sun: [1.28, 1.0, 0.65],
    sky: [0.4, 0.48, 0.55],
    ground: [0.26, 0.28, 0.19],
    fog: [0.62, 0.72, 0.6],
    night: 0,
  },
  {
    at: 0.46,
    elev: 14,
    azim: 150,
    sun: [1.35, 0.62, 0.28],
    sky: [0.34, 0.3, 0.34],
    ground: [0.22, 0.18, 0.14],
    fog: [0.72, 0.52, 0.42],
    night: 0.1,
  },
  {
    at: 0.54,
    elev: 4,
    azim: 170,
    sun: [0.5, 0.22, 0.18],
    sky: [0.16, 0.15, 0.26],
    ground: [0.1, 0.09, 0.13],
    fog: [0.28, 0.22, 0.32],
    night: 0.55,
  },
  {
    at: 0.62,
    elev: 48,
    azim: 220,
    sun: [0.17, 0.22, 0.36],
    sky: [0.07, 0.1, 0.18],
    ground: [0.035, 0.05, 0.09],
    fog: [0.05, 0.07, 0.13],
    night: 1,
  },
  {
    at: 0.86,
    elev: 42,
    azim: 300,
    sun: [0.15, 0.2, 0.33],
    sky: [0.065, 0.09, 0.16],
    ground: [0.03, 0.045, 0.08],
    fog: [0.048, 0.065, 0.12],
    night: 1,
  },
  {
    at: 0.94,
    elev: 8,
    azim: 350,
    sun: [1.1, 0.5, 0.35],
    sky: [0.24, 0.2, 0.28],
    ground: [0.14, 0.12, 0.13],
    fog: [0.5, 0.38, 0.4],
    night: 0.35,
  },
];
const WRAP: Key = { ...KEYS[0], at: 1, azim: KEYS[0].azim + 360 };

function lerpRgb(a: Rgb, b: Rgb, t: number, out: [number, number, number]) {
  out[0] = lerp(a[0], b[0], t);
  out[1] = lerp(a[1], b[1], t);
  out[2] = lerp(a[2], b[2], t);
}

export function createDayCycle(startWave = 0) {
  const { wavesPerDay, startPhase, lapse } = DAYCYCLE;
  const lapseTarget = startPhase + startWave / wavesPerDay;
  const lapseSpan = (startWave / wavesPerDay) % 1;
  let lapseT = startWave > 0 && lapseSpan > 1e-6 ? 0 : -1;
  let t = lapseTarget - lapseSpan;
  const out = {
    sunDir: [0, 1, 0],
    sunColor: [0, 0, 0],
    ambientSky: [0, 0, 0],
    ambientGround: [0, 0, 0],
    fogColor: [0, 0, 0],
    nightFactor: 0,
  } satisfies LightingValues;

  return {
    get timeOfDay() {
      return t % 1;
    },
    get lapsing() {
      return lapseT >= 0;
    },
    update(dt: number, waveN: number): typeof out {
      if (lapseT >= 0) {
        lapseT += dt;
        const k = Math.min(lapseT / lapse.duration, 1);
        const e = smooth01(0, 1, k);
        t = lapseTarget - lapseSpan * (1 - e);
        if (k >= 1) lapseT = -1;
      } else {
        const target = startPhase + waveN / wavesPerDay;
        const gap = Math.max(0, target - t);
        t += Math.min(gap, dt * Math.min(Math.max(gap * 0.08, 0.0015), 0.012));
      }

      const phase = t % 1;
      let a = WRAP;
      let b = WRAP;
      for (let i = 0; i < KEYS.length; i++) {
        const next = i + 1 < KEYS.length ? KEYS[i + 1] : WRAP;
        if (phase >= KEYS[i].at && phase < next.at) {
          a = KEYS[i];
          b = next;
          break;
        }
      }
      const k = smooth01(a.at, b.at, phase);

      const elev = (lerp(a.elev, b.elev, k) * Math.PI) / 180;
      const azim = (lerp(a.azim, b.azim, k) * Math.PI) / 180;
      out.sunDir[0] = Math.cos(elev) * Math.sin(azim);
      out.sunDir[1] = Math.sin(elev);
      out.sunDir[2] = Math.cos(elev) * Math.cos(azim);
      lerpRgb(a.sun, b.sun, k, out.sunColor);
      lerpRgb(a.sky, b.sky, k, out.ambientSky);
      lerpRgb(a.ground, b.ground, k, out.ambientGround);
      lerpRgb(a.fog, b.fog, k, out.fogColor);
      out.nightFactor = lerp(a.night, b.night, k);
      return out;
    },
  };
}

export type DayCycle = ReturnType<typeof createDayCycle>;
