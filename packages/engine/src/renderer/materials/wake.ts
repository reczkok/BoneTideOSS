/**
 * Toxic Wake keystone: the poison slick each volley arrow leaves behind,
 * with veins, fresh-drip highlights and popping bubbles.
 */
import { d, std, type TgpuRoot } from 'typegpu';
import { perlin2d } from '@typegpu/noise';
import { KEYSTONES, MAX_VOLLEY, VOLLEY } from '../../config.ts';
import { hash22 } from '../../core/gpu.ts';
import { VolleyArrow, type VolleyBuffer } from '../../core/schemas.ts';
import { camera } from '../scene/bindings.ts';

const FLIGHT_LIFE = VOLLEY.range / VOLLEY.speed;
const WAKE_LIFE = FLIGHT_LIFE + KEYSTONES.toxicWake.linger;

export function createWakeMaterial(root: TgpuRoot, volleyBuf: VolleyBuffer) {
  const arrows = root.createReadonly(d.arrayOf(VolleyArrow, MAX_VOLLEY), volleyBuf.buffer);
  const enabled = root.createUniform(d.u32, 0);

  /** (wetness, freshness) of the slick at `p`. */
  const wakeAt = (p: d.v2f) => {
    'use gpu';
    const t = camera.$.time;
    let wet = d.f32(0);
    let fresh = d.f32(0);
    const wob = perlin2d.sample(p * 2.3 + d.vec2f(5.3, 77.7)) * 0.5 + 0.5;
    for (const k of std.range(MAX_VOLLEY)) {
      const a = arrows.$[k];
      const age = t - a.start;
      if (a.damage <= 0 || age < 0 || age >= WAKE_LIFE) continue;
      const segLen = std.min(age, FLIGHT_LIFE) * VOLLEY.speed;
      const rel = p - a.origin;
      const along = std.clamp(std.dot(rel, a.dir), 0, segLen);
      const dseg = std.distance(p, a.origin + a.dir * along);
      const dry = 1 - std.smoothstep(FLIGHT_LIFE, WAKE_LIFE, age);
      const effR = KEYSTONES.toxicWake.radius * (0.65 + 0.55 * wob) * (0.4 + 0.6 * dry);
      if (dseg < effR) {
        const m = std.smoothstep(effR, effR * 0.3, dseg) * dry;
        wet = std.max(wet, m);
        const ptAge = age - along * (1 / VOLLEY.speed);
        fresh = std.max(fresh, std.exp(-ptAge * 2.2) * m);
      }
    }
    return d.vec2f(wet, fresh);
  };

  const bubbles = (colorIn: d.v3f, p: d.v2f, wet: number) => {
    'use gpu';
    const t = camera.$.time;
    let color = d.vec3f(colorIn);
    const cell = std.floor(p * 3.2);
    const h = hash22(cell);
    const phase = std.fract(t * (0.4 + h.y * 0.45) + h.x * 9);
    const center = (cell + 0.25 + h * 0.5) * (1 / 3.2);
    const dist = std.distance(p, center);
    const radius = (0.07 + 0.1 * h.y) * std.sqrt(std.min(phase, 0.92) * (1 / 0.92));
    const occupied = std.smoothstep(0.3, 0.42, h.x);
    const alive = occupied * std.smoothstep(0.97, 0.9, phase) * wet;
    const dome = std.smoothstep(radius, radius * 0.45, dist);
    color = std.mix(color, d.vec3f(0.035, 0.085, 0.028), dome * alive * 0.55);
    const rim = std.smoothstep(0.026, 0.004, std.abs(dist - radius * 0.88));
    color += d.vec3f(0.5, 1.5, 0.4) * (rim * alive * 0.8);
    const glint = std.smoothstep(
      radius * 0.38,
      0,
      std.distance(p, center + d.vec2f(-0.35) * radius),
    );
    color += d.vec3f(1.5, 3.2, 1.0) * (glint * alive);
    const pop = std.smoothstep(0.92, 1, phase);
    const ringlet = std.smoothstep(0.03, 0.004, std.abs(dist - radius * (1 + pop * 1.6)));
    color += d.vec3f(0.9, 2.6, 0.5) * (ringlet * pop * (1 - pop) * 4 * occupied * wet);
    return color;
  };

  const wakeShade = (colorIn: d.v3f, p: d.v2f) => {
    'use gpu';
    let color = d.vec3f(colorIn);
    if (enabled.$ === 1) {
      const t = camera.$.time;
      const w = wakeAt(p);
      const wet = w.x;
      if (wet > 0.004) {
        color = std.mix(color, d.vec3f(0.05, 0.11, 0.035), wet * 0.85);
        const sheen = std.max(perlin2d.sample(p * 1.5 + d.vec2f(t * 0.5, -t * 0.34)), 0);
        color += d.vec3f(0.16, 0.42, 0.1) * (sheen * sheen * wet);
        const warp = perlin2d.sample(p * 0.9 + d.vec2f(-t * 0.16, t * 0.12));
        const vn = perlin2d.sample(p * 1.2 + d.vec2f(warp * 0.6 + t * 0.05, -t * 0.06));
        const vein = std.smoothstep(0.1, 0.008, std.abs(vn));
        const pulse = 0.7 + 0.3 * std.sin(t * 2.7 + warp * 5);
        color += d.vec3f(0.45, 1.8, 0.22) * (vein * wet * pulse * 0.9);
        color += d.vec3f(0.3, 1.2, 0.15) * (w.y * 0.9);
        color = bubbles(color, p, wet);
      }
    }
    return color;
  };

  return {
    wakeShade,
    setEnabled(on: boolean) {
      enabled.write(on ? 1 : 0);
    },
  };
}
