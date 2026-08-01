/**
 * The per-frame scene state every pass reads, declared once as accessors and
 * slots. `createEnv` binds them to real uniforms and textures with
 * `root.with(...)`; shader code in this directory reads them through `.$`
 * without knowing what backs them.
 */
import tgpu, { d, type TgpuComparisonSampler, type TgpuSampler } from 'typegpu';
import { TELEGRAPH } from '../../config.ts';
import {
  CameraData,
  FxData,
  Lighting,
  MAX_POINT_LIGHTS,
  PointLight,
  TelegraphEntry,
} from '../../core/schemas.ts';

export const camera = tgpu.accessor(CameraData);
export const fx = tgpu.accessor(FxData);
export const lighting = tgpu.accessor(Lighting);
export const lightVP = tgpu.accessor(d.mat4x4f);
export const frameDt = tgpu.accessor(d.f32);
export const reveal = tgpu.accessor(d.f32);
export const pointLights = tgpu.accessor(d.arrayOf(PointLight, MAX_POINT_LIGHTS));
export const lightCount = tgpu.accessor(d.u32);
export const telegraphs = tgpu.accessor(d.arrayOf(TelegraphEntry, TELEGRAPH.max));
export const telegraphCount = tgpu.accessor(d.u32);

export const shadowMap = tgpu.accessor(d.textureDepth2d());
export const cloudMap = tgpu.accessor(d.texture2d(d.f32));
/** Simulation field, texel per cell: A = (fuel, heat, waterHeight), B = (waterVx, waterVz, steam). */
export const fieldA = tgpu.accessor(d.texture2d(d.f32));
export const fieldB = tgpu.accessor(d.texture2d(d.f32));

export const linearSampler = tgpu.slot<TgpuSampler>();
export const shadowSampler = tgpu.slot<TgpuComparisonSampler>();
/** Shadow-map resolution, baked per quality tier. */
export const shadowSize = tgpu.slot<number>();
