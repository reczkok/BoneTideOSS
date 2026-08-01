/**
 * Scene lighting: sun + hemisphere ambient, PCF shadows, baked cloud cover,
 * point lights, storm dimming and distance fog. Pure shader functions over
 * the accessors in `bindings.ts`.
 */
import tgpu, { d, std } from 'typegpu';
import { perlin2d } from '@typegpu/noise';
import { CLOUDS, REVEAL, WELL } from '../../config.ts';
import { MAX_POINT_LIGHTS } from '../../core/schemas.ts';
import { fresnel } from '../../core/gpu.ts';
import {
  camera,
  cloudMap,
  fx,
  lightCount,
  lighting,
  lightVP,
  linearSampler,
  pointLights,
  reveal,
  shadowMap,
  shadowSampler,
  shadowSize,
} from './bindings.ts';

export const CLOUD_TEX = 256;
export const CLOUD_HALF = 130;

const SHADOW_BIAS = 0.0022;
const STORM_DIM_GAIN = 0.68;

const POISSON = tgpu.const(d.arrayOf(d.vec2f, 8), [
  d.vec2f(-0.7071, 0.7071),
  d.vec2f(0.7071, 0.7071),
  d.vec2f(-0.7071, -0.7071),
  d.vec2f(0.7071, -0.7071),
  d.vec2f(-0.3536, 0.0),
  d.vec2f(0.3536, 0.0),
  d.vec2f(0.0, -0.3536),
  d.vec2f(0.0, 0.3536),
]);

/** (near, far) fog distances, pulled in while the arena is still being revealed. */
export const fogBand = () => {
  'use gpu';
  return d.vec2f(
    std.mix(d.f32(REVEAL.fogNearFrom), d.f32(REVEAL.fogNearTo), reveal.$),
    std.mix(d.f32(REVEAL.fogFarFrom), d.f32(REVEAL.fogFarTo), reveal.$),
  );
};

export const viewDirTo = (wPos: d.v3f) => {
  'use gpu';
  return std.normalize(camera.$.camPos - wPos);
};

const lightContrib = (lp: d.v3f, lc: d.v3f, lr: number, wPos: d.v3f, nn: d.v3f) => {
  'use gpu';
  const toL = lp - wPos;
  const dist = std.length(toL);
  let out = d.vec3f();
  if (dist < lr) {
    const fall = 1 - dist / lr;
    const ndl = std.max(std.dot(nn, toL * (1 / std.max(dist, 1e-3))), 0);
    out = lc * (fall * fall * ndl);
  }
  return out;
};

export const pointLightAt = (wPos: d.v3f, nn: d.v3f) => {
  'use gpu';
  let acc = d.vec3f();
  for (const i of std.range(MAX_POINT_LIGHTS)) {
    if (d.u32(i) >= lightCount.$) break;
    const L = pointLights.$[i];
    acc += lightContrib(L.pos, L.color, L.radius, wPos, nn);
  }
  return acc;
};

/** Light-space (uv, depth) of a world position; w = 1 when outside the shadow frustum. */
const shadowCoord = (wPos: d.v3f) => {
  'use gpu';
  const lp = lightVP.$ * d.vec4f(wPos, 1);
  const uv = lp.xy * d.vec2f(0.5, -0.5) + 0.5;
  const outside = uv.x < 0 || uv.x > 1 || uv.y < 0 || uv.y > 1 || lp.z > 1;
  return d.vec4f(uv, lp.z - SHADOW_BIAS, std.select(d.f32(0), d.f32(1), outside));
};

/** 8-tap Poisson PCF shadow visibility. */
export const sampleShadow = (wPos: d.v3f) => {
  'use gpu';
  const sc = shadowCoord(wPos);
  if (sc.w > 0.5) {
    return d.f32(1);
  }
  const spread = 1.6 / shadowSize.$;
  let s = d.f32(0);
  for (const k of tgpu.unroll(std.range(8))) {
    s += std.textureSampleCompareLevel(
      shadowMap.$,
      shadowSampler.$,
      sc.xy + POISSON.$[k] * spread,
      sc.z,
    );
  }
  return s * 0.125;
};

/** Single-tap shadow visibility, for volumetric marching. */
export const shadowVis = (wPos: d.v3f) => {
  'use gpu';
  const sc = shadowCoord(wPos);
  if (sc.w > 0.5) {
    return d.f32(1);
  }
  return std.textureSampleCompareLevel(shadowMap.$, shadowSampler.$, sc.xy, sc.z);
};

/** 0..1 darkening from the chain-lightning flash and the gravity well's collapse. */
export const stormDim = () => {
  'use gpu';
  const age = camera.$.time - fx.$.chainStart;
  let dim = d.f32(0);
  if (age >= 0 && age < 1.3) {
    dim = std.exp(-age * 3.0);
  }
  if (fx.$.wellStart >= 0) {
    const wt = camera.$.time - fx.$.wellStart;
    let wd = std.smoothstep(WELL.duration - 0.7, WELL.duration, wt) * 0.85;
    if (wt >= WELL.duration) {
      wd = std.exp(-(wt - WELL.duration) * 7) * 0.85;
    }
    dim = std.max(dim, wd);
  }
  return dim;
};

/** Sunlight multiplier after storm dimming. */
export const stormLight = () => {
  'use gpu';
  return 1 - stormDim() * STORM_DIM_GAIN;
};

/** Analytic cloud shadow, baked into `cloudMap` by `createEnv` and sampled by `cloudLight`. */
export const cloudLightAnalytic = (p: d.v2f) => {
  'use gpu';
  const drift = d.vec2f(CLOUDS.windX, CLOUDS.windZ) * camera.$.time;
  const q = p * CLOUDS.scale + drift;
  const n = perlin2d.sample(q) * 0.72 + perlin2d.sample(q * 2.6 + d.vec2f(13.7, 41.3)) * 0.34;
  const cover = std.smoothstep(CLOUDS.coverage, CLOUDS.coverage + CLOUDS.softness, n);
  return 1 - cover * CLOUDS.strength * (1 - lighting.$.nightFactor * CLOUDS.nightFade);
};

export const cloudLight = (p: d.v2f) => {
  'use gpu';
  const uv = (p + CLOUD_HALF) * (1 / (CLOUD_HALF * 2));
  return std.textureSampleLevel(cloudMap.$, linearSampler.$, uv, 0).x;
};

export const applyFog = (color: d.v3f, wPos: d.v3f) => {
  'use gpu';
  const band = fogBand();
  const fog = std.smoothstep(band.x, band.y, std.distance(wPos, camera.$.camPos));
  return std.mix(color, lighting.$.fogColor * stormLight(), fog);
};

/** Full surface shading for lit geometry; `flash` blends toward the hit-flash colour. */
export const shade = (albedo: d.v3f, n: d.v3f, wPos: d.v3f, flash: number) => {
  'use gpu';
  const nn = std.normalize(n);
  const ndl = std.max(std.dot(nn, lighting.$.sunDir), 0);
  const sun = lighting.$.sunColor * (ndl * sampleShadow(wPos) * cloudLight(wPos.xz));
  const hemi = std.mix(lighting.$.ambientGround, lighting.$.ambientSky, nn.y * 0.5 + 0.5);
  const rim = fresnel(nn, viewDirTo(wPos), 3) * 0.18;
  const lightScale = stormLight();
  let color =
    albedo * ((hemi + sun) * lightScale + pointLightAt(wPos, nn)) +
    lighting.$.ambientSky * (rim * lightScale);
  color = std.mix(color, d.vec3f(1.6, 0.6, 0.45), flash * 0.8);
  return applyFog(color, wPos);
};

/** Irradiance on an upward-facing surface, without fog. */
export const flatLight = (wPos: d.v3f) => {
  'use gpu';
  const sun = lighting.$.sunColor * (lighting.$.sunDir.y * 0.85 * sampleShadow(wPos));
  return (
    (lighting.$.ambientSky * 0.9 + sun * cloudLight(wPos.xz)) * stormLight() +
    pointLightAt(wPos, d.vec3f(0, 1, 0))
  );
};
