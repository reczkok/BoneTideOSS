/**
 * Post-processing chain over the HDR scene target: heat/shock/lens haze
 * offsets, bloom (bright pass + separable blur at half res), volumetric sun
 * rays, then composite with soft clipping, reveal veil, hurt vignette and
 * screen flash, optionally followed by FXAA when MSAA is off.
 */
import tgpu, { common, d, std, type TgpuRoot, type TgpuUniform } from 'typegpu';
import { perlin2d } from '@typegpu/noise';
import { HAZE, METEOR, RAYS, REVEAL, SHOCK, WELL } from '../config.ts';
import { fieldCoord, inField } from '../sim/field.ts';
import type { Env } from './env.ts';
import { OFFSET_FORMAT } from './formats.ts';
import type { LiveRenderOptions } from './quality.ts';
import { camera, fieldA, fx, lighting, linearSampler, reveal } from './scene/bindings.ts';
import { cloudLight, shadowVis, stormLight } from './scene/lighting.ts';
import type { FrameTargets } from './targets.ts';

const BLOOM_STRENGTH = 0.55;
const BLOOM_KNEE = 0.85;
const CLIP_START = 0.8;

const srcLayout = tgpu.bindGroupLayout({
  tex: { texture: d.texture2d(d.f32) },
});
const compositeLayout = tgpu.bindGroupLayout({
  scene: { texture: d.texture2d(d.f32) },
  bloom: { texture: d.texture2d(d.f32) },
  rays: { texture: d.texture2d(d.f32) },
  hazeOffset: { texture: d.texture2d(d.f32) },
});

/** Camera ray through a screen uv: near point (xyz) and unit direction, as two vec4s. */
const unproject = (uv: d.v2f, depth: number) => {
  'use gpu';
  const ndc = d.vec2f(uv.x * 2 - 1, (1 - uv.y) * 2 - 1);
  const h = camera.$.invViewProj * d.vec4f(ndc, depth, 1);
  return h.xyz * (1 / h.w);
};

const worldToUv = (w: d.v3f) => {
  'use gpu';
  const clip = camera.$.viewProj * d.vec4f(w, 1);
  return clip.xy * (1 / clip.w) * d.vec2f(0.5, -0.5) + 0.5;
};

/** World point where the camera ray through `uv` meets the ground plane. */
const groundHit = (uv: d.v2f) => {
  'use gpu';
  const near = unproject(uv, d.f32(0));
  const far = unproject(uv, d.f32(1));
  const dy = far.y - near.y;
  let t = d.f32(0);
  if (std.abs(dy) > 1e-5) {
    t = -near.y / dy;
  }
  return near.xz + (far.xz - near.xz) * t;
};

const softClip = (x: d.v3f) => {
  'use gpu';
  const over = std.max(x - CLIP_START, d.vec3f());
  const arg = std.min(over * (1 / (1 - CLIP_START)), d.vec3f(10));
  return std.min(x, d.vec3f(CLIP_START)) + std.tanh(arg) * (1 - CLIP_START);
};

const rec709 = (c: d.v3f) => {
  'use gpu';
  return std.dot(c, d.vec3f(0.2126, 0.7152, 0.0722));
};

export function createPostPass(
  root: TgpuRoot,
  env: Env,
  canvasFormat: GPUTextureFormat,
  context: GPUCanvasContext,
  initialOptions: LiveRenderOptions,
) {
  let options = { ...initialOptions };
  const screenFx = root.createUniform(d.struct({ flash: d.f32, hurt: d.f32 }));
  /** Texel size of the half-res bloom targets, and of the full-res target. */
  const halfTexel = root.createUniform(d.vec2f);
  const fullTexel = root.createUniform(d.vec2f);
  const raysStrength = root.createUniform(d.f32);

  const hazeFrag = tgpu.fragmentFn({ in: { uv: d.vec2f }, out: d.vec4f })((input) => {
    'use gpu';
    const time = camera.$.time;
    const f = fx.$;
    const uv = input.uv;
    const gp = groundHit(uv);
    const aspect = halfTexel.$.y / halfTexel.$.x;
    let off = d.vec2f();

    if (f.meteorImpact >= 0) {
      const t = time - f.meteorImpact;
      const s =
        std.smoothstep(METEOR.radius + 1, 0.5, std.distance(gp, f.meteorPos)) * std.exp(-t * 0.45);
      if (s > 0.002) {
        const n1 = perlin2d.sample(uv * 40 + d.vec2f(0, -time * 3));
        const n2 = perlin2d.sample(uv * 37 + d.vec2f(19.7, -time * 2.6));
        off += d.vec2f(n1, n2) * (s * HAZE.heatAmp);
      }
    }

    const cell = fieldCoord(gp);
    if (inField(cell)) {
      const heat = std.textureLoad(fieldA.$, cell, 0).y;
      if (heat > 0.05) {
        const n1 = perlin2d.sample(uv * 44 + d.vec2f(7.3, -time * 3.4));
        const n2 = perlin2d.sample(uv * 41 + d.vec2f(31.1, -time * 2.9));
        off += d.vec2f(n1, n2) * (std.min(heat, 1) * HAZE.heatAmp);
      }
    }

    if (f.shockStart >= 0) {
      const t = time - f.shockStart;
      if (t >= 0 && t < 0.8) {
        const ring = std.abs(std.distance(gp, f.shockOrigin) - t * SHOCK.speed);
        const band = std.smoothstep(1.4, 0, ring) * (1 - t / 0.8);
        if (band > 0.002) {
          const originUv = worldToUv(d.vec3f(f.shockOrigin.x, 0, f.shockOrigin.y));
          const q = (uv - originUv) * d.vec2f(aspect, 1);
          const ql = std.length(q);
          if (ql > 1e-4) {
            off += q * ((band * HAZE.shockAmp) / ql) * d.vec2f(1 / aspect, 1);
          }
        }
      }
    }

    if (f.wellStart >= 0) {
      const wt = time - f.wellStart;
      if (wt >= 0 && wt < WELL.duration) {
        const ramp = std.min(std.min(wt * 4, 1), (WELL.duration - wt) * 2.5);
        const wellUv = worldToUv(d.vec3f(f.wellPos.x, 1.0, f.wellPos.y));
        const q = (uv - wellUv) * d.vec2f(aspect, 1);
        const r = std.length(q);
        if (r < HAZE.lensRadius && r > 1e-4) {
          const lens = std.smoothstep(HAZE.lensRadius, 0, r) * r * HAZE.lensAmp * ramp;
          const dirq = q * (1 / r);
          const perpq = d.vec2f(-dirq.y, dirq.x);
          off += (dirq * -lens + perpq * (lens * HAZE.swirl)) * d.vec2f(1 / aspect, 1);
        }
      }
    }
    return d.vec4f(off, 0, 1);
  });

  const brightFrag = tgpu.fragmentFn({ in: { uv: d.vec2f }, out: d.vec4f })((input) => {
    'use gpu';
    const c = std.textureSample(srcLayout.$.tex, linearSampler.$, input.uv).rgb;
    const gain = std.smoothstep(BLOOM_KNEE, BLOOM_KNEE + 0.9, rec709(c));
    return d.vec4f(c * gain, 1);
  });

  // 5-tap Gaussian using bilinear sampling (Rastergrid "linear sampling").
  const LIN_WEIGHTS = [0.227027027, 0.3162162162, 0.0702702703] as const;
  const LIN_OFFSETS = [0, 1.3846153846, 3.2307692308] as const;
  const blurAlong = (uv: d.v2f, dir: d.v2f) => {
    'use gpu';
    let acc = std.textureSample(srcLayout.$.tex, linearSampler.$, uv).rgb * LIN_WEIGHTS[0];
    for (const k of tgpu.unroll([1, 2])) {
      const off = dir * (halfTexel.$ * d.f32(LIN_OFFSETS[k]));
      acc += std.textureSample(srcLayout.$.tex, linearSampler.$, uv + off).rgb * LIN_WEIGHTS[k];
      acc += std.textureSample(srcLayout.$.tex, linearSampler.$, uv - off).rgb * LIN_WEIGHTS[k];
    }
    return acc;
  };
  const blurHFrag = tgpu.fragmentFn({ in: { uv: d.vec2f }, out: d.vec4f })((input) => {
    'use gpu';
    return d.vec4f(blurAlong(input.uv, d.vec2f(1, 0)), 1);
  });
  const blurVFrag = tgpu.fragmentFn({ in: { uv: d.vec2f }, out: d.vec4f })((input) => {
    'use gpu';
    return d.vec4f(blurAlong(input.uv, d.vec2f(0, 1)), 1);
  });

  const raysFrag = tgpu.fragmentFn({ in: { uv: d.vec2f }, out: d.vec4f })((input) => {
    'use gpu';
    const near = unproject(input.uv, d.f32(0));
    const rayDir = std.normalize(unproject(input.uv, d.f32(1)) - near);
    let end = d.f32(RAYS.maxDist);
    if (rayDir.y < -1e-4) {
      end = std.min(end, -near.y / rayDir.y);
    }
    const stepLen = end / RAYS.steps;
    const px = input.uv / halfTexel.$;
    const jitter = std.fract(52.9829189 * std.fract(px.x * 0.06711056 + px.y * 0.00583715));
    let tRay = stepLen * jitter;
    let acc = d.f32(0);
    for (const _ of tgpu.unroll(std.range(RAYS.steps))) {
      const wp = near + rayDir * tRay;
      const haze = std.exp(-std.max(wp.y, 0) * (1 / RAYS.scaleHeight));
      acc += shadowVis(wp) * haze;
      tRay += stepLen;
    }
    const mu = std.dot(rayDir, lighting.$.sunDir);
    const phase = RAYS.baseScatter + RAYS.forwardScatter * std.pow(std.max(mu, 0), 4);
    const groundP = near + rayDir * end;
    const gate = cloudLight(groundP.xz) * stormLight();
    const shaft = acc * stepLen * RAYS.density * phase * raysStrength.$ * gate;
    return d.vec4f(lighting.$.sunColor * shaft, 1);
  });

  const compositeFrag = tgpu.fragmentFn({ in: { uv: d.vec2f }, out: d.vec4f })((input) => {
    'use gpu';
    const off = std.textureSample(compositeLayout.$.hazeOffset, linearSampler.$, input.uv).xy;
    const suv = std.clamp(input.uv + off, d.vec2f(0.001), d.vec2f(0.999));
    const scene = std.textureSample(compositeLayout.$.scene, linearSampler.$, suv).rgb;
    const bloom = std.textureSample(compositeLayout.$.bloom, linearSampler.$, input.uv).rgb;
    const rays = std.textureSample(compositeLayout.$.rays, linearSampler.$, input.uv).rgb;
    let color = softClip(scene + bloom * BLOOM_STRENGTH + rays);
    const veil = 1 - std.smoothstep(0, REVEAL.veilEnd, reveal.$);
    color = std.mix(color, lighting.$.fogColor * stormLight(), veil);
    const r = std.length(input.uv - 0.5) * 1.42;
    const vignette = std.smoothstep(0.45, 1.05, r) * std.min(screenFx.$.hurt, 1);
    color = std.mix(color, d.vec3f(0.42, 0.02, 0.02), vignette);
    color = std.mix(color, d.vec3f(0.93, 0.96, 1.05), std.min(screenFx.$.flash, 1));
    return d.vec4f(color, 1);
  });

  const fxaaFrag = makeFxaaFrag(fullTexel);

  const fullscreen = <F extends typeof brightFrag>(fragment: F, format: GPUTextureFormat) =>
    env.gpu.createRenderPipeline({
      vertex: common.fullScreenTriangle,
      fragment,
      targets: { format },
    });
  const brightPipeline = fullscreen(brightFrag, env.format);
  const blurHPipeline = fullscreen(blurHFrag, env.format);
  const blurVPipeline = fullscreen(blurVFrag, env.format);
  const raysPipeline = fullscreen(raysFrag, env.format);
  const hazePipeline = fullscreen(hazeFrag, OFFSET_FORMAT);
  const compositePipeline = fullscreen(compositeFrag, canvasFormat);
  const fxaaPipeline = fullscreen(fxaaFrag, canvasFormat);

  const makeBinds = (t: FrameTargets) => ({
    bright: root.createBindGroup(srcLayout, { tex: t.sceneSampled }),
    blurH: root.createBindGroup(srcLayout, { tex: t.bloomASampled }),
    blurV: root.createBindGroup(srcLayout, { tex: t.bloomBSampled }),
    composite: root.createBindGroup(compositeLayout, {
      scene: t.sceneSampled,
      bloom: t.bloomASampled,
      rays: t.raysSampled,
      hazeOffset: t.hazeSampled,
    }),
    fxaa: root.createBindGroup(srcLayout, { tex: t.postSampled }),
  });
  let binds: ReturnType<typeof makeBinds> | null = null;
  let hazeActive = false;
  /** Whether the optional targets currently hold black, so skipping their pass is safe. */
  let raysCleared = false;
  let hazeCleared = false;
  const fxScratch = { flash: 0, hurt: 0 };

  const clearTarget = (encoder: GPUCommandEncoder, view: GPUTextureView) => {
    encoder
      .beginRenderPass({
        colorAttachments: [
          { view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } },
        ],
      })
      .end();
  };
  const clearAttachment = { loadOp: 'clear', storeOp: 'store' } as const;

  return {
    setOptions(next: LiveRenderOptions) {
      options = { ...next };
    },
    setFx(flash: number, hurt: number) {
      fxScratch.flash = flash;
      fxScratch.hurt = hurt;
      screenFx.write(fxScratch);
    },
    setHazeActive(active: boolean) {
      hazeActive = active;
    },
    bind(targets: FrameTargets) {
      halfTexel.write([2 / targets.width, 2 / targets.height]);
      fullTexel.write([1 / targets.width, 1 / targets.height]);
      binds = makeBinds(targets);
      raysCleared = false;
      hazeCleared = false;
    },
    draw(encoder: GPUCommandEncoder, targets: FrameTargets) {
      if (!binds) return;

      if (hazeActive) {
        hazePipeline
          .with(encoder)
          .withColorAttachment({ view: targets.hazeView, ...clearAttachment })
          .draw(3);
        hazeCleared = false;
      } else if (!hazeCleared) {
        clearTarget(encoder, targets.hazeViewRaw);
        hazeCleared = true;
      }

      brightPipeline
        .with(encoder)
        .with(binds.bright)
        .withColorAttachment({ view: targets.bloomAView, ...clearAttachment })
        .draw(3);
      blurHPipeline
        .with(encoder)
        .with(binds.blurH)
        .withColorAttachment({ view: targets.bloomBView, ...clearAttachment })
        .draw(3);

      const strength = options.rays ? env.raysStrength() : 0;
      if (strength >= 0.01) {
        raysStrength.write(strength);
        raysPipeline
          .with(encoder)
          .withColorAttachment({ view: targets.raysView, ...clearAttachment })
          .draw(3);
        raysCleared = false;
      } else if (!raysCleared) {
        clearTarget(encoder, targets.raysViewRaw);
        raysCleared = true;
      }

      blurVPipeline
        .with(encoder)
        .with(binds.blurV)
        .withColorAttachment({ view: targets.bloomAView, ...clearAttachment })
        .draw(3);

      const fxaaOn = options.fxaa && env.msaa === 1;
      compositePipeline
        .with(encoder)
        .with(binds.composite)
        .withColorAttachment({ view: fxaaOn ? targets.postView : context, ...clearAttachment })
        .draw(3);
      if (fxaaOn) {
        fxaaPipeline
          .with(encoder)
          .with(binds.fxaa)
          .withColorAttachment({ view: context, ...clearAttachment })
          .draw(3);
      }
    },
  };
}

const FXAA_EDGE_MIN = 0.0312;
const FXAA_EDGE = 0.125;
const FXAA_SUBPIX = 0.75;
const FXAA_STEPS = tgpu.const(d.arrayOf(d.f32, 10), [1, 1, 1, 1.5, 2, 2, 2, 2, 4, 8]);

const lumaOf = (c: d.v3f) => {
  'use gpu';
  return std.dot(c, d.vec3f(0.299, 0.587, 0.114));
};

/** FXAA 3.11 "quality" edge-walking anti-aliasing over `srcLayout.tex`. */
function makeFxaaFrag(texel: TgpuUniform<d.Vec2f>) {
  const lumaAt = (uv: d.v2f, ox: number, oy: number) => {
    'use gpu';
    const p = uv + d.vec2f(ox, oy) * texel.$;
    return lumaOf(std.textureSampleLevel(srcLayout.$.tex, linearSampler.$, p, 0).rgb);
  };
  const sampleLuma = (uv: d.v2f) => {
    'use gpu';
    return lumaOf(std.textureSampleLevel(srcLayout.$.tex, linearSampler.$, uv, 0).rgb);
  };

  return tgpu.fragmentFn({ in: { uv: d.vec2f }, out: d.vec4f })((input) => {
    'use gpu';
    const uv = input.uv;
    const center = std.textureSampleLevel(srcLayout.$.tex, linearSampler.$, uv, 0);
    const lumaC = lumaOf(center.rgb);
    const lumaN = lumaAt(uv, 0, -1);
    const lumaS = lumaAt(uv, 0, 1);
    const lumaL = lumaAt(uv, -1, 0);
    const lumaR = lumaAt(uv, 1, 0);
    const lumaMin = std.min(lumaC, std.min(std.min(lumaN, lumaS), std.min(lumaL, lumaR)));
    const lumaMax = std.max(lumaC, std.max(std.max(lumaN, lumaS), std.max(lumaL, lumaR)));
    const range = lumaMax - lumaMin;
    if (range < std.max(d.f32(FXAA_EDGE_MIN), lumaMax * FXAA_EDGE)) {
      return center;
    }
    const lumaNL = lumaAt(uv, -1, -1);
    const lumaNR = lumaAt(uv, 1, -1);
    const lumaSL = lumaAt(uv, -1, 1);
    const lumaSR = lumaAt(uv, 1, 1);
    const lumaNS = lumaN + lumaS;
    const lumaLR = lumaL + lumaR;
    const cornersL = lumaNL + lumaSL;
    const cornersR = lumaNR + lumaSR;
    const cornersN = lumaNL + lumaNR;
    const cornersS = lumaSL + lumaSR;
    const edgeH =
      std.abs(-2 * lumaL + cornersL) +
      std.abs(-2 * lumaC + lumaNS) * 2 +
      std.abs(-2 * lumaR + cornersR);
    const edgeV =
      std.abs(-2 * lumaN + cornersN) +
      std.abs(-2 * lumaC + lumaLR) * 2 +
      std.abs(-2 * lumaS + cornersS);
    const isHorizontal = edgeH >= edgeV;
    const luma1 = std.select(lumaL, lumaN, isHorizontal);
    const luma2 = std.select(lumaR, lumaS, isHorizontal);
    const gradient1 = luma1 - lumaC;
    const gradient2 = luma2 - lumaC;
    const is1Steepest = std.abs(gradient1) >= std.abs(gradient2);
    const gradientScaled = 0.25 * std.max(std.abs(gradient1), std.abs(gradient2));
    let stepLength = std.select(texel.$.x, texel.$.y, isHorizontal);
    let lumaLocalAvg = 0.5 * (luma2 + lumaC);
    if (is1Steepest) {
      stepLength = -stepLength;
      lumaLocalAvg = 0.5 * (luma1 + lumaC);
    }
    const stepAxis = std.select(d.vec2f(stepLength, 0), d.vec2f(0, stepLength), isHorizontal);
    const currentUv = uv + stepAxis * 0.5;
    const exploreOff = std.select(d.vec2f(0, texel.$.y), d.vec2f(texel.$.x, 0), isHorizontal);
    let uv1 = currentUv - exploreOff;
    let uv2 = currentUv + exploreOff;
    let lumaEnd1 = sampleLuma(uv1) - lumaLocalAvg;
    let lumaEnd2 = sampleLuma(uv2) - lumaLocalAvg;
    let reached1 = std.abs(lumaEnd1) >= gradientScaled;
    let reached2 = std.abs(lumaEnd2) >= gradientScaled;
    if (!reached1) {
      uv1 = uv1 - exploreOff;
    }
    if (!reached2) {
      uv2 = uv2 + exploreOff;
    }
    for (const k of std.range(10)) {
      if (reached1 && reached2) {
        break;
      }
      if (!reached1) {
        lumaEnd1 = sampleLuma(uv1) - lumaLocalAvg;
        reached1 = std.abs(lumaEnd1) >= gradientScaled;
        if (!reached1) {
          uv1 = uv1 - exploreOff * FXAA_STEPS.$[k];
        }
      }
      if (!reached2) {
        lumaEnd2 = sampleLuma(uv2) - lumaLocalAvg;
        reached2 = std.abs(lumaEnd2) >= gradientScaled;
        if (!reached2) {
          uv2 = uv2 + exploreOff * FXAA_STEPS.$[k];
        }
      }
    }
    const dist1 = std.select(uv.y - uv1.y, uv.x - uv1.x, isHorizontal);
    const dist2 = std.select(uv2.y - uv.y, uv2.x - uv.x, isHorizontal);
    const isDir1 = dist1 < dist2;
    const edgeLen = dist1 + dist2;
    let pixelOffset = -std.min(dist1, dist2) / edgeLen + 0.5;
    const endLuma = std.select(lumaEnd2, lumaEnd1, isDir1);
    const wrongSide = std.select(endLuma >= 0, endLuma < 0, lumaC < lumaLocalAvg);
    if (wrongSide) {
      pixelOffset = 0;
    }
    const lumaAvg = (1 / 12) * (2 * (lumaNS + lumaLR) + cornersL + cornersR);
    const sub1 = std.clamp(std.abs(lumaAvg - lumaC) / range, 0, 1);
    const sub2 = (-2 * sub1 + 3) * sub1 * sub1;
    pixelOffset = std.max(pixelOffset, sub2 * sub2 * FXAA_SUBPIX);
    const finalUv = uv + stepAxis * pixelOffset;
    return std.textureSampleLevel(srcLayout.$.tex, linearSampler.$, finalUv, 0);
  });
}
