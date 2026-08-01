/**
 * CPU-side owner of the scene state: the uniforms behind `scene/bindings.ts`,
 * the shadow map and cloud bake, and the configured root (`env.gpu`) that
 * every scene pipeline is created from so those bindings resolve.
 */
import { d, std, type TgpuRoot } from 'typegpu';
import { mat4, vec3 } from 'wgpu-matrix';
import { CLOUDS, TELEGRAPH, type Rgb } from '../config.ts';
import { createKernel } from '../core/kernel.ts';
import { perlinRoot } from '../core/perlincache.ts';
import {
  CameraData,
  FxData,
  Lighting,
  TelegraphEntry,
  type TelegraphRecord,
} from '../core/schemas.ts';
import type { FieldTextures } from '../sim/field.ts';
import { DEPTH_FORMAT, rawView, SKY } from './formats.ts';
import { createPointLights } from './lights.ts';
import type { BakedRenderQuality } from './quality.ts';
import * as bind from './scene/bindings.ts';
import { CLOUD_HALF, CLOUD_TEX, cloudLightAnalytic } from './scene/lighting.ts';

export type { LightSpec, SteadyLightSpec } from './lights.ts';

export interface LightingValues {
  sunDir: Rgb;
  sunColor: Rgb;
  ambientSky: Rgb;
  ambientGround: Rgb;
  fogColor: Rgb;
  nightFactor: number;
}

const SUN_DIR = vec3.normalize([0.5, 0.82, 0.28]);
const SHADOW_MIN_Y = 0.34;
const SHADOW_HALF = 24;
const SHADOW_NEAR = 15;
const SHADOW_FAR = 160;
const SHADOW_EYE_DIST = 70;

const fxAtRest = (): d.InferInput<typeof FxData> => ({
  playerPos: [0, 0],
  shockOrigin: [0, 0],
  meteorPos: [0, 0],
  wellPos: [0, 0],
  spikeOrigin: [0, 0],
  spikeDir: [0, 1],
  shockStart: -100,
  meteorImpact: -100,
  chainStart: -100,
  wellStart: -100,
  spikeStart: -100,
  firePos: [0, 0],
  fireStart: -100,
  swingDir: [0, 1],
  swingStart: -100,
  swingArc: 0,
  swingSign: 1,
  waterZapStart: -100,
});

const smooth01 = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

const copyRgb = (out: [number, number, number], value: Rgb) => {
  out[0] = value[0];
  out[1] = value[1];
  out[2] = value[2];
};

export function createEnv(
  root: TgpuRoot,
  format: GPUTextureFormat,
  quality: BakedRenderQuality,
  fieldTex: FieldTextures,
) {
  const camera = root.createUniform(CameraData);
  const fx = root.createUniform(FxData, fxAtRest());
  const frameDt = root.createUniform(d.f32);
  const lightVP = root.createUniform(d.mat4x4f);
  const reveal = root.createUniform(d.f32, 1);
  const lightingVectors = {
    sunDir: [SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]],
    sunColor: [1.2, 1.04, 0.74],
    ambientSky: [0.42, 0.5, 0.52],
    ambientGround: [0.26, 0.28, 0.21],
    fogColor: [...SKY],
  } satisfies Record<string, [number, number, number]>;
  const lightingValue: d.InferInput<typeof Lighting> = {
    ...lightingVectors,
    nightFactor: 0,
    fireOn: 0,
    waterOn: 0,
  };
  const lighting = root.createUniform(Lighting, lightingValue);
  const lights = createPointLights(root);
  const telegraphs = root.createUniform(d.arrayOf(TelegraphEntry, TELEGRAPH.max));
  const telegraphCount = root.createUniform(d.u32, 0);

  const sampler = root.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
  });
  const shadowSampler = root.createComparisonSampler({
    compare: 'less',
    magFilter: 'linear',
    minFilter: 'linear',
  });
  const shadowTex = root
    .createTexture({ size: [quality.shadowSize, quality.shadowSize], format: DEPTH_FORMAT })
    .$usage('render', 'sampled');
  const shadowTarget = rawView(root, shadowTex.createView('render'));
  const cloudTex = root
    .createTexture({ size: [CLOUD_TEX, CLOUD_TEX], format: 'rgba8unorm' })
    .$usage('sampled', 'storage');
  const cloudStorage = cloudTex.createView(d.textureStorage2d('rgba8unorm', 'write-only'));

  /** Root with every scene binding attached; all scene pipelines are created from it. */
  const gpu = perlinRoot(root)
    .with(bind.camera, camera)
    .with(bind.fx, fx)
    .with(bind.lighting, lighting)
    .with(bind.lightVP, lightVP)
    .with(bind.frameDt, frameDt)
    .with(bind.reveal, reveal)
    .with(bind.pointLights, lights.buffer)
    .with(bind.lightCount, lights.countBuffer)
    .with(bind.telegraphs, telegraphs)
    .with(bind.telegraphCount, telegraphCount)
    .with(bind.shadowMap, shadowTex.createView(d.textureDepth2d()))
    .with(bind.cloudMap, cloudTex.createView(d.texture2d(d.f32)))
    .with(bind.fieldA, fieldTex.sampledA)
    .with(bind.fieldB, fieldTex.sampledB)
    .with(bind.linearSampler, sampler)
    .with(bind.shadowSampler, shadowSampler)
    .with(bind.shadowSize, quality.shadowSize);

  const cloudBake = createKernel(gpu, [CLOUD_TEX, CLOUD_TEX], (x: number, y: number) => {
    'use gpu';
    const texel = (CLOUD_HALF * 2) / CLOUD_TEX;
    const p = (d.vec2f(d.f32(x), d.f32(y)) + 0.5) * texel - CLOUD_HALF;
    const cover = d.vec4f(cloudLightAnalytic(p), 0, 0, 1);
    std.textureStore(cloudStorage.$, d.vec2u(d.u32(x), d.u32(y)), cover);
  });
  let cloudFrame = 0;

  const clearColor: GPUColorDict = { r: SKY[0], g: SKY[1], b: SKY[2], a: 1 };
  let currentNight = 0;
  let currentRays = 0;

  const shadow = {
    dir: new Float32Array(SUN_DIR),
    eye: new Float32Array(3),
    center: new Float32Array(3),
    view: new Float32Array(16),
    proj: new Float32Array(16),
    vp: new Float32Array(16),
    half: SHADOW_HALF,
  };
  const setShadowZoom = (z: number) => {
    const h = SHADOW_HALF * Math.max(1, z);
    shadow.half = h;
    mat4.ortho(-h, h, -h, h, SHADOW_NEAR, SHADOW_FAR, shadow.proj);
  };
  setShadowZoom(1);

  /** Re-aims the shadow frustum at the focus point, snapped to shadow texels so edges do not swim. */
  function updateLight(focusX: number, focusZ: number) {
    const texel = (shadow.half * 2) / quality.shadowSize;
    const cx = Math.round(focusX / texel) * texel;
    const cz = Math.round(focusZ / texel) * texel;
    shadow.center[0] = cx;
    shadow.center[2] = cz;
    vec3.mulScalar(shadow.dir, SHADOW_EYE_DIST, shadow.eye);
    shadow.eye[0] += cx;
    shadow.eye[2] += cz;
    mat4.lookAt(shadow.eye, shadow.center, [0, 1, 0], shadow.view);
    mat4.multiply(shadow.proj, shadow.view, shadow.vp);
    lightVP.write(shadow.vp);
  }
  updateLight(0, 0);

  function setLighting(v: LightingValues) {
    copyRgb(lightingVectors.sunDir, v.sunDir);
    copyRgb(lightingVectors.sunColor, v.sunColor);
    copyRgb(lightingVectors.ambientSky, v.ambientSky);
    copyRgb(lightingVectors.ambientGround, v.ambientGround);
    copyRgb(lightingVectors.fogColor, v.fogColor);
    lightingValue.nightFactor = v.nightFactor;
    lighting.write(lightingValue);
    currentNight = v.nightFactor;
    const elev = v.sunDir[1];
    currentRays =
      (0.35 + 0.65 * smooth01(0.55, 0.12, elev)) *
      smooth01(0.0, 0.1, elev) *
      (1 - v.nightFactor * 0.6);
    shadow.dir[0] = v.sunDir[0];
    shadow.dir[1] = Math.max(v.sunDir[1], SHADOW_MIN_Y);
    shadow.dir[2] = v.sunDir[2];
    vec3.normalize(shadow.dir, shadow.dir);
    [clearColor.r, clearColor.g, clearColor.b] = v.fogColor;
  }

  let lastTelegraphCount = 0;
  function setTelegraphs(entries: readonly TelegraphRecord[] | null, count: number) {
    if (count === 0 && lastTelegraphCount === 0) return;
    lastTelegraphCount = count;
    telegraphCount.write(count);
    if (count > 0 && entries) telegraphs.write(entries as TelegraphRecord[]);
  }

  const sceneDepth = (depthWriteEnabled: boolean) => ({
    multisample: { count: quality.msaa } satisfies GPUMultisampleState,
    depthStencil: {
      format: DEPTH_FORMAT,
      depthWriteEnabled,
      depthCompare: 'less',
    } satisfies GPUDepthStencilState,
  });

  return {
    gpu,
    format,
    msaa: quality.msaa,
    sceneDepth,
    camera,
    fx,
    reveal,
    clearColor,
    shadowTarget,
    nightFactor: () => currentNight,
    raysStrength: () => currentRays,
    setLighting,
    setFireOn(on: boolean) {
      lightingValue.fireOn = on ? 1 : 0;
      lighting.write(lightingValue);
    },
    setWaterOn(on: boolean) {
      lightingValue.waterOn = on ? 1 : 0;
      lighting.write(lightingValue);
    },
    setShadowZoom,
    addLight: lights.add,
    setSteadyLight: lights.setSteady,
    setTelegraphs,
    /** Per-frame uniform updates plus the periodic cloud bake, recorded into the prepass. */
    beginFrame(dt: number, focusX: number, focusZ: number, prep: GPUComputePassEncoder) {
      frameDt.write(dt);
      updateLight(focusX, focusZ);
      lights.update(dt);
      if (cloudFrame++ % CLOUDS.bakeInterval === 0) cloudBake.run(prep);
    },
    /** Pre-records a scene-pass draw sequence into a render bundle. */
    bundle(record: (encoder: GPURenderBundleEncoder) => void) {
      const be = root.device.createRenderBundleEncoder({
        colorFormats: [format],
        depthStencilFormat: DEPTH_FORMAT,
        sampleCount: quality.msaa,
      });
      record(be);
      return be.finish();
    },
    reset() {
      lights.clear();
      fx.write(fxAtRest());
      lights.update(0);
      setTelegraphs(null, 0);
    },
    destroy() {
      shadowTex.destroy();
      cloudTex.destroy();
    },
  };
}

export type Env = ReturnType<typeof createEnv>;
