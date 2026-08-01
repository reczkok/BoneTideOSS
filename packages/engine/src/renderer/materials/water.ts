/**
 * Flood water over the ground: depth-tinted absorption, caustics, flow
 * crests and foam, plus the chain-lightning zap arcing across the surface.
 */
import { d, std } from 'typegpu';
import { perlin2d } from '@typegpu/noise';
import { ARENA_RADIUS, WATER } from '../../config.ts';
import { fieldUv } from '../../sim/field.ts';
import { camera, fieldA, fieldB, fx, lighting, linearSampler } from '../scene/bindings.ts';
import { viewDirTo } from '../scene/lighting.ts';
import { crackEdge } from './scorch.ts';

const WET_R2 = (ARENA_RADIUS + 1.5) * (ARENA_RADIUS + 1.5);
const ABSORB = d.vec3f(...WATER.absorb);
const BODY = d.vec3f(...WATER.bodyColor);

/** (height, vx, vz) of the water at `p`, zero outside the arena. */
export const waterAt = (p: d.v2f) => {
  'use gpu';
  let w = d.vec3f();
  if (std.dot(p, p) < WET_R2) {
    const a = std.textureSampleLevel(fieldA.$, linearSampler.$, fieldUv(p), 0);
    const b = std.textureSampleLevel(fieldB.$, linearSampler.$, fieldUv(p), 0);
    w = d.vec3f(a.z, b.x, b.y);
  }
  return w;
};

const waterDepthAt = (p: d.v2f) => {
  'use gpu';
  let h = d.f32(0);
  if (std.dot(p, p) < WET_R2) {
    h = std.textureSampleLevel(fieldA.$, linearSampler.$, fieldUv(p), 0).z;
  }
  return h;
};

const zapGlow = (p: d.v2f, wet: number) => {
  'use gpu';
  const t = camera.$.time;
  const zapT = t - fx.$.waterZapStart;
  let glow = d.vec3f();
  if (fx.$.waterZapStart >= 0 && zapT >= 0 && zapT < WATER.zapDuration) {
    const fade = 1 - zapT / WATER.zapDuration;
    const jump = std.floor(t * 24) * 7.31;
    const strobe = perlin2d.sample(p * 2.2 + d.vec2f(jump, 3.7));
    const strobe2 = perlin2d.sample(p * 4.1 + d.vec2f(17.9, jump * 1.7));
    const vein =
      std.smoothstep(0.35, 0.85, std.abs(strobe) * 1.7) +
      std.smoothstep(0.45, 0.9, std.abs(strobe2) * 1.7) * 0.7;
    glow += d.vec3f(1.5, 2.6, 4.6) * (std.min(vein, 1.6) * wet * fade);
    const burst = std.max(0, 1 - zapT * 3);
    glow += d.vec3f(0.5, 0.95, 1.8) * ((burst + 0.18) * wet * fade);
  }
  return glow;
};

/** Shades ground colour `ground` seen through water `w` (from `waterAt`) lit by `lit`. */
export const waterShade = (ground: d.v3f, wPos: d.v3f, w: d.v3f, lit: d.v3f) => {
  'use gpu';
  const p = wPos.xz;
  const t = camera.$.time;
  const h = std.min(w.x, WATER.hMax);
  const speed = std.min(std.length(w.yz), WATER.vMax);
  const flowN = w.yz * (1 / std.max(speed, 0.001));
  const wet = std.smoothstep(0.015, 0.1, h);
  const deep = std.smoothstep(0.08, 0.85, h);
  const lum = std.clamp(std.dot(lit, d.vec3f(0.35, 0.45, 0.3)), 0.08, 1.3);

  const eps = 0.7;
  const hX = waterDepthAt(p + d.vec2f(eps, 0));
  const hZ = waterDepthAt(p + d.vec2f(0, eps));
  const wob = perlin2d.sample(p * 0.45 + d.vec2f(t * 0.22, 17.9));
  const bandPhase = std.dot(p, flowN) * 2.1 - t * 4.2 + wob * 3.1;
  const crestAmp = std.min(speed * 0.4, 1) * 0.16;
  const crest = std.sin(bandPhase);
  const dCrest = std.cos(bandPhase) * 2.1 * crestAmp;
  const ripple = perlin2d.sample(p * 2.6 + d.vec2f(t * 0.5, -t * 0.37));
  const slope = (d.vec2f(hX, hZ) - h) * (0.9 / eps) + flowN * dCrest + ripple * 0.16;
  const n = std.normalize(d.vec3f(-slope.x, 1, -slope.y));

  let color = ground * (1 - std.smoothstep(0.003, 0.06, h) * 0.3);

  const warp = perlin2d.sample(p * 0.6 + d.vec2f(t * 0.3, -t * 0.23)) * 0.7;
  const ca1 = crackEdge(p * WATER.causticScale + d.vec2f(t * 0.34 + warp, t * 0.21));
  const ca2 = crackEdge(p * (WATER.causticScale * 1.31) + d.vec2f(-t * 0.27, t * 0.38 - warp));
  const caustic = ca1 * 0.4 + ca1 * ca2 * 1.2;
  const causticWindow = std.smoothstep(0.04, 0.16, h);
  color += d.vec3f(0.5, 0.8, 0.85) * (caustic * causticWindow * lum * WATER.causticStrength);

  const transmit = std.exp(ABSORB * -h);
  const body = BODY * lum;
  color = body + (color - body) * transmit;

  const viewDir = viewDirTo(wPos);
  const cosV = std.max(std.dot(n, viewDir), 0);
  const fres = 0.04 + 0.96 * std.pow(1 - cosV, 3);
  const tilt = std.clamp(1 - n.y, 0, 1);
  color += lighting.$.ambientSky * ((fres + tilt * 0.5) * WATER.sheenStrength * wet);

  const halfV = std.normalize(lighting.$.sunDir + viewDir);
  const spec = std.pow(std.max(std.dot(n, halfV), 0), WATER.specPower);
  color += lighting.$.sunColor * (spec * WATER.specStrength * (0.3 + 0.7 * deep) * lum * wet);
  const sparkle = std.pow(std.clamp(ripple * 0.5 + 0.5, 0, 1), 16);
  color += d.vec3f(0.9, 1.0, 1.1) * (sparkle * deep * lum * (0.7 + 0.3 * crest));

  const churn = std.smoothstep(1.1, 4.5, speed);
  const web = crackEdge(p * 0.85 - flowN * (t * 1.9));
  let foam = web * churn * (0.55 + 0.45 * ripple);
  foam += std.smoothstep(0.55, 0.95, crest) * (churn * deep * 0.7);
  const frontBreak = perlin2d.sample(p * 3.3 + d.vec2f(0, t * 1.3));
  const front = std.smoothstep(0.02, 0.055, h) * (1 - std.smoothstep(0.055, 0.2, h));
  foam += front * std.smoothstep(0.4, 2.5, speed) * std.clamp(0.65 + frontBreak, 0, 1);
  foam = std.clamp(foam, 0, 1);
  color = std.mix(color, d.vec3f(0.95, 0.99, 1.03) * std.max(lum, 0.3), foam * wet * 0.9);

  return color + zapGlow(p, wet);
};
