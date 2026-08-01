/**
 * Ability marks left on the ground: nova ring and scorch cracks, meteor
 * crater, ice-spike frost lane, and the gravity well's dish and collapse ring.
 */
import tgpu, { d, std } from 'typegpu';
import { perlin2d } from '@typegpu/noise';
import { METEOR, SHOCK, SPIKES, WELL } from '../../config.ts';
import { hash21, hash22, lateral } from '../../core/gpu.ts';
import { camera, fx } from '../scene/bindings.ts';
import { spikeTooth } from '../scene/terrain.ts';

const SHOCK_REACH = SHOCK.maxRadius + SHOCK.width;

/** Cellular (Worch) edge mask: 1 on cell borders, 0 inside. */
export const crackEdge = (q: d.v2f) => {
  'use gpu';
  const cp = q * 0.95;
  const ip = std.floor(cp);
  const fp = cp - ip;
  let f1 = d.f32(8);
  let f2 = d.f32(8);
  for (const dz of tgpu.unroll([-1, 0, 1])) {
    for (const dx of tgpu.unroll([-1, 0, 1])) {
      const off = d.vec2f(dx, dz);
      const dist = std.length(off + hash22(ip + off) - fp);
      if (dist < f1) {
        f2 = f1;
        f1 = dist;
      } else if (dist < f2) {
        f2 = dist;
      }
    }
  }
  return std.smoothstep(0.24, 0.03, f2 - f1);
};

/** Glowing crack network radiating from an impact, cooling over `duration`. */
const scorchCracks = (
  colorIn: d.v3f,
  rel: d.v2f,
  p: d.v2f,
  dist: number,
  reach: number,
  t: number,
  duration: number,
) => {
  'use gpu';
  let color = d.vec3f(colorIn);
  const net = crackEdge(rel);
  const ang = std.atan2(rel.y, rel.x);
  const wob = perlin2d.sample(p * 0.5 + d.vec2f(13.7, 71.3));
  const spoke = std.smoothstep(0.09, 0.008, std.abs(std.sin(ang * 5 + wob * 4 + dist * 0.25)));
  const edgeFade = std.smoothstep(reach, reach - 1.5, dist);
  const crack = std.max(net, spoke * 0.9) * edgeFade;
  const fade = 1 - t / duration;
  const heat = std.exp(-t * 1.3);

  color = std.mix(color, d.vec3f(0.055, 0.045, 0.04), crack * fade * 0.9);
  const lip = std.clamp(crackEdge(rel + d.vec2f(0.13, 0.09)) - net, 0, 1);
  color += d.vec3f(0.32, 0.3, 0.24) * (lip * fade * 0.7 * edgeFade);
  color += d.vec3f(2.0, 0.55, 0.1) * (crack * crack * heat * 2.6);
  const ember = perlin2d.sample(rel * 2.1 + d.vec2f(camera.$.time * 1.3, 0));
  color += d.vec3f(1.4, 0.4, 0.05) * (crack * heat * std.max(0, ember) * 1.2);
  return color;
};

const novaMark = (colorIn: d.v3f, p: d.v2f) => {
  'use gpu';
  let color = d.vec3f(colorIn);
  const t = camera.$.time - fx.$.shockStart;
  const r = t * SHOCK.speed;
  if (r < SHOCK_REACH) {
    const dRing = std.abs(std.distance(p, fx.$.shockOrigin) - r);
    const band = std.smoothstep(1.3, 0, dRing) * (1 - r / SHOCK_REACH);
    color += d.vec3f(1.25, 0.82, 0.3) * (band * 1.5);
  }
  if (t < SHOCK.crackDuration) {
    const rel = p - fx.$.shockOrigin;
    const dist = std.length(rel);
    const reach = std.min(t * SHOCK.speed, SHOCK.maxRadius);
    if (dist < reach && dist > 0.001) {
      color = scorchCracks(color, rel, p, dist, reach, t, SHOCK.crackDuration);
    }
  }
  return color;
};

const craterMark = (colorIn: d.v3f, p: d.v2f) => {
  'use gpu';
  let color = d.vec3f(colorIn);
  const t = camera.$.time - fx.$.meteorImpact;
  if (t >= 0 && t < METEOR.craterDuration) {
    const rel = p - fx.$.meteorPos;
    const dist = std.length(rel);
    const reach = std.min(t * 40, METEOR.radius + 0.8);
    if (dist < reach && dist > 0.001) {
      const fade = 1 - t / METEOR.craterDuration;
      color = std.mix(
        color,
        d.vec3f(0.07, 0.055, 0.045),
        std.smoothstep(2.6, 0.4, dist) * fade * 0.85,
      );
      color = scorchCracks(color, rel, p, dist, reach, t, METEOR.craterDuration);
    }
  }
  return color;
};

const frostLane = (colorIn: d.v3f, p: d.v2f) => {
  'use gpu';
  let color = d.vec3f(colorIn);
  const t = camera.$.time - fx.$.spikeStart;
  if (t >= 0 && t < SPIKES.duration) {
    const rel = p - fx.$.spikeOrigin;
    const along = std.dot(rel, fx.$.spikeDir);
    const lat = std.abs(lateral(rel, fx.$.spikeDir));
    const front = std.min(t * SPIKES.speed, SPIKES.range);
    if (along > -0.5 && along < front + 1.2 && lat < SPIKES.width) {
      const across = std.smoothstep(SPIKES.width, SPIKES.width * 0.3, lat);
      const inside =
        std.smoothstep(front + 0.4, front - 0.6, along) * std.smoothstep(-0.4, 0.4, along);
      const fade = 1 - t / SPIKES.duration;
      const cover = inside * across * fade;
      color = std.mix(color, d.vec3f(0.36, 0.58, 0.92), cover * 0.85);
      const net = crackEdge(rel * 1.3);
      color = std.mix(color, d.vec3f(0.02, 0.09, 0.2), net * cover * 0.8);
      const tooth = spikeTooth(p);
      color = std.mix(color, d.vec3f(0.55, 0.8, 1.2), tooth * cover * 0.95);
      const cold = fade * (0.55 + 0.45 * std.exp(-t * 1.2));
      color += d.vec3f(0.1, 0.9, 1.9) * (net * inside * across * cold * 1.7);
      color += d.vec3f(0.5, 1.0, 1.7) * (tooth * tooth * inside * across * cold * 1.3);
      const glitter = hash21(std.floor(p * 13));
      const twinkle = std.pow(std.max(0, std.sin(camera.$.time * 2.6 + glitter * 61)), 22);
      color += d.vec3f(1.1, 1.7, 2.5) * (twinkle * std.smoothstep(0.75, 0.85, glitter) * cover);
      const travelling = 1 - std.smoothstep(0, 0.25, t - SPIKES.range / SPIKES.speed);
      const lead = std.smoothstep(1.0, 0, std.abs(along - front)) * travelling;
      color += d.vec3f(0.7, 1.15, 1.7) * (lead * across * 1.4);
    }
  }
  return color;
};

const wellMark = (colorIn: d.v3f, p: d.v2f) => {
  'use gpu';
  let color = d.vec3f(colorIn);
  const wt = camera.$.time - fx.$.wellStart;
  const rel = p - fx.$.wellPos;
  const dist = std.length(rel);
  if (wt >= 0 && wt < WELL.duration) {
    if (dist < WELL.radius) {
      const rampIn = std.min(wt * 4, 1);
      const inner = std.smoothstep(WELL.radius, WELL.radius * 0.1, dist);
      color = std.mix(color, d.vec3f(0.045, 0.03, 0.09), inner * rampIn * 0.75);
      const ang = std.atan2(rel.y, rel.x);
      const arm = std.max(0, std.sin(ang * 3 + wt * 3.2 + dist * 0.9));
      color += d.vec3f(0.65, 0.28, 1.35) * (std.pow(arm, 6) * inner * rampIn * 0.8);
      const rim = std.smoothstep(0.55, 0.05, std.abs(dist - WELL.radius * 0.16));
      color += d.vec3f(0.9, 0.4, 1.9) * (rim * rampIn);
    }
  } else if (wt < WELL.duration + 0.7) {
    const ct = wt - WELL.duration;
    const band = std.smoothstep(1.6, 0, std.abs(dist - ct * 26)) * (1 - ct / 0.7);
    color += d.vec3f(1.3, 0.6, 2.4) * (band * 1.6);
  }
  return color;
};

/** Applies every active ability mark to the ground colour at `p`. */
export const groundMarks = (colorIn: d.v3f, p: d.v2f) => {
  'use gpu';
  let color = d.vec3f(colorIn);
  if (fx.$.shockStart >= 0) {
    color = novaMark(color, p);
  }
  if (fx.$.meteorImpact >= 0) {
    color = craterMark(color, p);
  }
  if (fx.$.spikeStart >= 0) {
    color = frostLane(color, p);
  }
  if (fx.$.wellStart >= 0) {
    color = wellMark(color, p);
  }
  return color;
};
