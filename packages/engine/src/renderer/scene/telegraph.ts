/**
 * Enemy attack telegraphs drawn onto the ground: discs, arcs and lanes with
 * an ember-textured rim that swells toward the strike.
 */
import { d, std } from 'typegpu';
import { perlin2d } from '@typegpu/noise';
import { TELEGRAPH } from '../../config.ts';
import { lateral } from '../../core/gpu.ts';
import type { TelegraphEntry } from '../../core/schemas.ts';
import { camera, telegraphCount, telegraphs } from './bindings.ts';

export const TG_COLOR = d.vec3f(...TELEGRAPH.color);
const TG_GATE = TELEGRAPH.lineWidth * 2 + TELEGRAPH.edgeWobble;

const KIND_ARC = 0.5;
const KIND_LANE = 1.5;

/** Signed distance to the telegraph's edge (x) and the arc feather gate (y). */
const edgeOf = (e: d.InferGPU<typeof TelegraphEntry>, rel: d.v2f, d2: number) => {
  'use gpu';
  if (e.kind > KIND_LANE) {
    const along = std.dot(rel, e.dir);
    const lat = std.abs(lateral(rel, e.dir));
    return d.vec2f(std.max(std.abs(along - e.radius * 0.5) - e.radius * 0.5, lat - e.halfArc), 1);
  }
  const dist = std.sqrt(d2);
  let arcGate = d.f32(1);
  if (e.kind < KIND_ARC) {
    const distG = std.max(dist, 0.001);
    arcGate = std.smoothstep(e.cosHalf * distG, e.cosFeatherIn * distG, std.dot(rel, e.dir));
  }
  return d.vec2f(dist - e.radius, arcGate);
};

export const telegraphMask = (p: d.v2f) => {
  'use gpu';
  let mask = d.f32(0);
  if (telegraphCount.$ > 0) {
    const t = camera.$.time;
    let sum = d.f32(0);
    let noiseReady = false;
    let wob = d.f32(0);
    let patchN = d.f32(0);
    for (const k of std.range(TELEGRAPH.max)) {
      if (d.u32(k) >= telegraphCount.$) break;
      const e = telegraphs.$[k];
      if (t < e.t0 || t > e.t1 + TELEGRAPH.linger) continue;
      const rel = p - e.pos;
      const d2 = std.dot(rel, rel);
      if (d2 > e.boundSq) continue;
      const edge = edgeOf(e, rel, d2);
      if (edge.x >= TG_GATE || edge.y <= 0.001) continue;
      if (!noiseReady) {
        noiseReady = true;
        wob = perlin2d.sample(p * 1.1 + d.vec2f(3.7, 9.1));
        patchN = perlin2d.sample(p * 1.9 + d.vec2f(-7.7, 21.3));
      }
      const appear = std.smoothstep(e.t0, e.t0 + TELEGRAPH.appear, t);
      const ramp = std.clamp((t - e.t0) / std.max(e.t1 - e.t0, 0.001), 0, 1);
      const swell = TELEGRAPH.base + (1 - TELEGRAPH.base) * ramp * ramp;
      const fade = 1 - std.smoothstep(e.t1, e.t1 + TELEGRAPH.linger, t);
      const rim = edge.x + wob * TELEGRAPH.edgeWobble;
      let line = 1 - std.smoothstep(0, TELEGRAPH.lineWidth, std.abs(rim));
      const cover = std.smoothstep(-0.25 - ramp * 0.85, 0.3, patchN);
      line *= TELEGRAPH.emberFloor + (1 - TELEGRAPH.emberFloor) * cover;
      const fill =
        TELEGRAPH.fill * (0.55 + 0.45 * patchN) * std.smoothstep(0, -TELEGRAPH.lineWidth * 2, rim);
      sum += (line + fill) * edge.y * (appear * swell * fade);
    }
    if (sum > 0) {
      const flickN = perlin2d.sample(p * 0.8 + d.vec2f(t * 0.55, -t * 0.4));
      const flick = 1 - TELEGRAPH.flicker + TELEGRAPH.flicker * std.clamp(flickN + 0.5, 0, 1);
      mask = sum * flick;
    }
  }
  return mask;
};

export const telegraphGlow = (p: d.v2f) => {
  'use gpu';
  return TG_COLOR * telegraphMask(p);
};
