/**
 * The arena floor: a baked albedo texture, lit flat, with fire scorching,
 * flood water, ability marks, the toxic-wake slick and telegraphs layered
 * on top. Drawn as a displaced grid while any ground deformation is active,
 * otherwise as a single quad, plus a far skirt out to the fog.
 */
import tgpu, { d, std, type TgpuRoot } from 'typegpu';
import { perlin2d } from '@typegpu/noise';
import { FIRE } from '../config.ts';
import { quadCorner } from '../core/gpu.ts';
import type { VolleyBuffer } from '../core/schemas.ts';
import { fieldUv } from '../sim/field.ts';
import type { Env } from './env.ts';
import { groundMarks } from './materials/scorch.ts';
import { createWakeMaterial } from './materials/wake.ts';
import { waterAt, waterShade } from './materials/water.ts';
import { camera, fieldA, lighting, linearSampler } from './scene/bindings.ts';
import { applyFog, flatLight } from './scene/lighting.ts';
import { groundHeight } from './scene/terrain.ts';
import { telegraphGlow } from './scene/telegraph.ts';

const GROUND_EXTENT = 130;
const GRID_N = 224;
const GRID_HALF = 64;
const ALBEDO_TEX = 2048;

const albedoAt = (p: d.v2f) => {
  'use gpu';
  const n1 = perlin2d.sample(p * 0.08);
  const n2 = perlin2d.sample(p * 0.23 + d.vec2f(37.2, 11.7));
  const n3 = perlin2d.sample(p * 0.021 + d.vec2f(91.4, 47.8));
  const n4 = perlin2d.sample(p * 0.85 + d.vec2f(7.3, 63.1));
  let color = std.mix(d.vec3f(0.23, 0.4, 0.16), d.vec3f(0.42, 0.56, 0.25), n1 * 0.5 + 0.5);
  color = std.mix(color, d.vec3f(0.33, 0.48, 0.28), std.smoothstep(-0.2, 0.6, n3) * 0.5);
  color = std.mix(color, d.vec3f(0.44, 0.38, 0.25), std.smoothstep(0.38, 0.62, n2) * 0.45);
  color = color * (0.9 + 0.13 * n4);
  const edgeAo = std.smoothstep(28, 36, std.length(p));
  return color * (1 - edgeAo * 0.35);
};

/** (fuel, heat) of the fire field at `p`; pristine outside the field. */
const fireAt = (p: d.v2f) => {
  'use gpu';
  let fire = d.vec2f(FIRE.fuelInit, 0);
  if (std.abs(p.x) < FIRE.half && std.abs(p.y) < FIRE.half) {
    fire = std.textureSampleLevel(fieldA.$, linearSampler.$, fieldUv(p), 0).xy;
  }
  return fire;
};

const groundOut = { position: d.builtin.position, wPos: d.vec3f };

const gridVert = tgpu.vertexFn({
  in: { vid: d.builtin.vertexIndex },
  out: groundOut,
})((input) => {
  'use gpu';
  const cell = d.u32(input.vid / 6);
  const corner = quadCorner(input.vid);
  const cx = cell % GRID_N;
  const cz = d.u32(cell / GRID_N);
  const uv = (d.vec2f(d.f32(cx), d.f32(cz)) + corner * 0.5 + 0.5) * (2 / GRID_N) - 1;
  const p2 = uv * GRID_HALF;
  const wPos = d.vec3f(p2.x, groundHeight(p2), p2.y);
  return { position: camera.$.viewProj * d.vec4f(wPos, 1), wPos };
});

const skirtVert = tgpu.vertexFn({
  in: { vid: d.builtin.vertexIndex },
  out: groundOut,
})((input) => {
  'use gpu';
  const c = quadCorner(input.vid);
  const wPos = d.vec3f(c.x * GROUND_EXTENT, -0.04, c.y * GROUND_EXTENT);
  return { position: camera.$.viewProj * d.vec4f(wPos, 1), wPos };
});

const flatVert = tgpu.vertexFn({
  in: { vid: d.builtin.vertexIndex },
  out: groundOut,
})((input) => {
  'use gpu';
  const c = quadCorner(input.vid);
  const wPos = d.vec3f(c.x * GRID_HALF, 0, c.y * GRID_HALF);
  return { position: camera.$.viewProj * d.vec4f(wPos, 1), wPos };
});

export function createGroundPass(root: TgpuRoot, env: Env, volleyBuf: VolleyBuffer) {
  const albedoTex = root
    .createTexture({ size: [ALBEDO_TEX, ALBEDO_TEX], format: 'rgba8unorm' })
    .$usage('sampled', 'storage');
  const albedoSampled = albedoTex.createView(d.texture2d(d.f32));
  const albedoStorage = albedoTex.createView(d.textureStorage2d('rgba8unorm', 'write-only'));

  // One-shot bake at startup, so a guarded pipeline that submits on its own is fine here.
  env.gpu
    .createGuardedComputePipeline((x: number, y: number) => {
      'use gpu';
      const texel = (GROUND_EXTENT * 2) / ALBEDO_TEX;
      const p = (d.vec2f(d.f32(x), d.f32(y)) + 0.5) * texel - GROUND_EXTENT;
      std.textureStore(albedoStorage.$, d.vec2u(d.u32(x), d.u32(y)), d.vec4f(albedoAt(p), 1));
    })
    .dispatchThreads(ALBEDO_TEX, ALBEDO_TEX);

  const wake = createWakeMaterial(root, volleyBuf);

  const groundFrag = tgpu.fragmentFn({
    in: { wPos: d.vec3f },
    out: d.vec4f,
  })((input) => {
    'use gpu';
    const p = input.wPos.xz;
    const uv = (p + GROUND_EXTENT) * (1 / (GROUND_EXTENT * 2));
    let color = std.textureSampleLevel(albedoSampled.$, linearSampler.$, uv, 0).rgb;
    const fire = fireAt(p);
    const burned = std.clamp(1 - fire.x / FIRE.fuelInit, 0, 1);
    color = std.mix(color, d.vec3f(0.062, 0.05, 0.042), burned * 0.85);
    const lit = flatLight(input.wPos);
    color = color * lit;
    if (fire.y > 0.02) {
      const t = camera.$.time;
      const flicker =
        0.75 + 0.5 * std.max(perlin2d.sample(p * 1.7 + d.vec2f(t * 2.3, -t * 1.9)), 0);
      color += d.vec3f(2.2, 0.68, 0.11) * (fire.y * flicker);
    }
    if (lighting.$.waterOn === 1) {
      const w = waterAt(p);
      if (w.x > 0.004) {
        color = waterShade(color, input.wPos, w, lit);
      }
    }
    color = groundMarks(color, p);
    color = wake.wakeShade(color, p);
    color += telegraphGlow(p);
    return d.vec4f(applyFog(color, input.wPos), 1);
  });

  const makePipeline = (vertex: typeof gridVert) =>
    env.gpu.createRenderPipeline({
      vertex,
      fragment: groundFrag,
      targets: { format: env.format },
      primitive: { topology: 'triangle-list' },
      ...env.sceneDepth(true),
    });
  const gridPipeline = makePipeline(gridVert);
  const skirtPipeline = makePipeline(skirtVert);
  const flatPipeline = makePipeline(flatVert);

  return {
    draw(pass: GPURenderPassEncoder, displaced: boolean) {
      if (displaced) gridPipeline.with(pass).draw(6 * GRID_N * GRID_N);
      else flatPipeline.with(pass).draw(6);
      skirtPipeline.with(pass).draw(6);
    },
    setToxicWake: wake.setEnabled,
    destroy() {
      albedoTex.destroy();
    },
  };
}
