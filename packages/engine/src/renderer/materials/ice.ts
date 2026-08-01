/**
 * Ice-rock look for the spike-ability boulders: refracted body colour,
 * internal crack veins, trapped bubbles, frost near the base and faceted
 * sun/moon glints.
 */
import { d, std } from 'typegpu';
import { perlin2d } from '@typegpu/noise';
import { ICE_ROCKS } from '../../config.ts';
import { fresnel } from '../../core/gpu.ts';
import { lighting } from '../scene/bindings.ts';

const ETA = d.f32(ICE_ROCKS.eta);

/** Blends the ice look over `lit` by `amount` (0 = plain rock). */
export const iceRockShade = (
  lit: d.v3f,
  nn: d.v3f,
  viewDir: d.v3f,
  wPos: d.v3f,
  localH: number,
  amount: number,
) => {
  'use gpu';
  const amb = lighting.$.ambientSky;
  const night = lighting.$.nightFactor;
  const facing = std.max(std.dot(nn, viewDir), 0);
  const fres = fresnel(nn, viewDir, 2.5);

  const kk = std.max(1 - ETA * ETA * (1 - facing * facing), 0);
  const refr = viewDir * -ETA + nn * (ETA * facing - std.sqrt(kk));
  const seesGround = std.smoothstep(0.15, -0.35, refr.y);
  const deep = std.mix(amb * d.vec3f(0.4, 0.5, 0.62), amb * d.vec3f(0.38, 0.52, 0.48), seesGround);
  let color = std.mix(lit, deep, facing * amount * ICE_ROCKS.refractGain);

  const p1 = wPos + refr * ICE_ROCKS.depthNear;
  const p2 = wPos + refr * ICE_ROCKS.depthFar;
  const c1 = d.vec2f(p1.x + p1.y * 0.7, p1.z - p1.y * 0.4) * ICE_ROCKS.crackScale;
  const c2 = d.vec2f(p2.x - p2.y * 0.5, p2.z + p2.y * 0.6) * ICE_ROCKS.crackScale;
  const vein1 = std.smoothstep(0.07, 0.012, std.abs(perlin2d.sample(c1)));
  const vein2 = std.smoothstep(0.1, 0.015, std.abs(perlin2d.sample(c2 + d.vec2f(31.7, 11.3))));
  const crackMask = std.smoothstep(0.05, 0.5, perlin2d.sample(c1 * 0.33 + d.vec2f(53.1, 27.9)));
  const cracks = (vein1 * 0.8 + vein2 * 0.4) * crackMask;
  color += amb * d.vec3f(2.3, 2.45, 2.6) * (cracks * facing * amount * ICE_ROCKS.crackGain);

  const bubbles = std.smoothstep(0.55, 0.75, perlin2d.sample(c1 * 2.6 + d.vec2f(7.7, 3.1)));
  color += amb * d.vec3f(1.7, 1.8, 1.9) * (bubbles * facing * amount * ICE_ROCKS.bubbleGain);
  color += amb * d.vec3f(1.35, 1.5, 1.7) * (amount * fres * 0.8);

  const frost = std.smoothstep(ICE_ROCKS.frostHeight, 0.02, localH) * amount;
  const sparkle = std.smoothstep(0.3, 0.8, perlin2d.sample(wPos.xz * 6.3));
  color = std.mix(
    color,
    amb * d.vec3f(2.3, 2.7, 3.2),
    frost * ICE_ROCKS.frostGain * (0.55 + 0.45 * sparkle),
  );

  const facet = std.floor(nn * d.f32(ICE_ROCKS.facets) + 0.5);
  const facetN = facet * (1 / std.max(std.length(facet), 1e-3));
  const halfV = std.normalize(viewDir + lighting.$.sunDir);
  const glint =
    std.pow(std.max(std.dot(facetN, halfV), 0), 90) * ICE_ROCKS.facetGain +
    std.pow(std.max(std.dot(nn, halfV), 0), 14) * 0.4;
  const sunGlint = lighting.$.sunColor * (glint * 1.6 * (1 - night));
  const moonGlint = d.vec3f(0.3, 0.45, 0.75) * (glint * 0.45 * night);
  return color + (sunGlint + moonGlint) * amount;
};
