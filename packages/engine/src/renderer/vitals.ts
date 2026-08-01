import tgpu, { common, d, std, type TgpuRoot } from 'typegpu';
import { perlin2d } from '@typegpu/noise';
import { ORBS } from '../config.ts';
import { saturate } from '../core/mathx.ts';
import { perlinRoot } from '../core/perlincache.ts';
import type { CpuRecord } from '../core/schemas.ts';
import { createFrameCadence } from './cadence.ts';

const OrbData = d.struct({
  deep: d.vec3f,
  bright: d.vec3f,
  fill: d.f32,
  surge: d.f32,
  pulse: d.f32,
  time: d.f32,
});

export type OrbKind = 'hp' | 'xp';

type OrbPalette = { deep: readonly number[]; bright: readonly number[] };

export function createVitalsCore(root: TgpuRoot, format: GPUTextureFormat) {
  const orbLayout = tgpu.bindGroupLayout({ orb: { uniform: OrbData } });

  const RING = ORBS.ringInner;
  const GOLD = d.vec3f(0.94, 0.78, 0.42);

  const orbFrag = tgpu.fragmentFn({ in: { uv: d.vec2f }, out: d.vec4f })((input) => {
    'use gpu';
    const o = orbLayout.$.orb;
    const t = o.time;
    const p = d.vec2f(input.uv.x - 0.5, 0.5 - input.uv.y) * 2;
    const r = std.length(p);
    const edgeAA = std.max(std.fwidth(r), 0.004);
    const alpha = 1 - std.smoothstep(0.985 - edgeAA, 0.985 + edgeAA, r);
    if (alpha < 0.002) {
      return d.vec4f();
    }

    const topLight = p.y * 0.5 + 0.5;
    const brush = perlin2d.sample(p * 9) * 0.05;
    const bevel = 1 - std.smoothstep(RING, 1, r);
    let ring = std.mix(
      d.vec3f(0.07, 0.055, 0.04),
      d.vec3f(0.38, 0.29, 0.16),
      std.clamp(topLight * 0.62 + bevel * 0.25 + brush, 0, 1),
    );
    const lip =
      std.smoothstep(0.018, 0, std.abs(r - (RING + 0.02))) * 0.75 +
      std.smoothstep(0.02, 0, std.abs(r - 0.96)) * 0.4;
    ring += GOLD * (lip * (0.35 + 0.65 * topLight));

    const pr = std.min(r / RING, 1);
    const z = std.sqrt(std.max(1 - pr * pr, 0.0001));
    const n = d.vec3f(p * (1 / RING), z);

    const fillY = (o.fill * 2 - 1) * 1.04;
    const wob =
      std.sin(p.x * 4.7 + t * 2.1) * ORBS.waveAmp +
      std.sin(p.x * 9.1 - t * 3.4) * ORBS.waveAmp2 +
      perlin2d.sample(d.vec2f(p.x * 1.7 + t * 0.4, t * 0.23)) * ORBS.noiseAmp;
    const dSurf = p.y - (fillY + wob);
    const inLiquid = std.smoothstep(0.012, -0.012, dSurf);

    const churn =
      perlin2d.sample(p * 2.4 + d.vec2f(0, -t * 0.45)) * 0.6 +
      perlin2d.sample(p * 5.3 + d.vec2f(t * 0.3, -t * 0.9)) * 0.3;
    let liquid = std.mix(o.deep, o.bright, std.clamp(0.26 + churn * 0.55, 0, 1));
    liquid += o.bright * (std.exp(std.min(dSurf, 0) * 5.5) * 0.55);
    liquid = liquid * (0.34 + 0.66 * z);
    liquid = liquid * (0.72 + 0.28 * std.exp(std.min(dSurf, 0) * 2.2));
    const bubN = perlin2d.sample(d.vec2f(p.x * 5.5, p.y * 5.5 - t * 1.05));
    const bub = std.smoothstep(0.44, 0.62, bubN) * std.smoothstep(-0.04, -0.2, dSurf);
    liquid += (o.bright * 0.4 + d.vec3f(0.08)) * (bub * z);
    liquid += (o.bright + d.vec3f(0.25)) * (std.smoothstep(0.02, 0, std.abs(dSurf)) * 0.3);
    liquid = liquid * (1 + o.pulse * (0.3 + 0.3 * std.sin(t * 5.5)) + o.surge * 0.9);

    const glass = o.deep * (0.1 + 0.1 * z) + d.vec3f(0.012, 0.014, 0.016);

    let inner = std.mix(glass, liquid, inLiquid);
    inner = inner * (0.55 + 0.45 * std.smoothstep(1, 0.72, pr));
    const spec = std.pow(std.max(std.dot(n, std.normalize(d.vec3f(-0.42, 0.62, 0.66))), 0), 48);
    const sheen = std.smoothstep(0.5, 0.06, std.length(p - d.vec2f(-0.34, 0.42)));
    inner += d.vec3f(1, 0.98, 0.94) * (spec * 0.5) + d.vec3f(0.5, 0.55, 0.62) * (sheen * 0.14);

    const innerMask = 1 - std.smoothstep(RING - edgeAA, RING + edgeAA, r);
    const col = std.mix(ring, inner, innerMask);
    return d.vec4f(col * alpha, alpha);
  });

  const pipeline = perlinRoot(root).createRenderPipeline({
    vertex: common.fullScreenTriangle,
    fragment: orbFrag,
    targets: { format },
  });

  function makeOrb(palette: OrbPalette) {
    const scratch: CpuRecord<typeof OrbData> = {
      deep: [palette.deep[0], palette.deep[1], palette.deep[2]],
      bright: [palette.bright[0], palette.bright[1], palette.bright[2]],
      fill: 1,
      surge: 0,
      pulse: 0,
      time: 0,
    };
    const buf = root.createBuffer(OrbData, scratch).$usage('uniform');
    return {
      buf,
      bind: root.createBindGroup(orbLayout, { orb: buf }),
      scratch,
    };
  }

  const hp = makeOrb(ORBS.hp);
  const xp = makeOrb(ORBS.xp);
  xp.scratch.fill = 0;
  let time = 0;
  const cadence = createFrameCadence(ORBS.maxFps);

  return {
    hp,
    xp,
    set(hpFrac: number, xpFrac: number) {
      hp.scratch.fill = saturate(hpFrac);
      xp.scratch.fill = saturate(xpFrac);
      const low = ORBS.lowPulseBelow;
      hp.scratch.pulse = saturate((low - hpFrac) / low);
    },
    surgeHp(amount: number) {
      hp.scratch.surge = Math.min(1, hp.scratch.surge + amount);
    },
    surgeXp() {
      xp.scratch.surge = 1;
    },
    reset() {
      hp.scratch.fill = 1;
      xp.scratch.fill = 0;
      hp.scratch.surge = 0;
      xp.scratch.surge = 0;
      hp.scratch.pulse = 0;
    },
    tick(dt: number) {
      const elapsed = cadence.tick(dt);
      if (elapsed === null) return false;
      time += elapsed;
      const decay = Math.exp(-ORBS.surgeDecay * elapsed);
      for (const orb of [hp, xp]) {
        orb.scratch.surge *= decay;
        orb.scratch.time = time;
      }
      return true;
    },
    invalidate: cadence.invalidate,
    draw(orb: typeof hp, enc: GPUCommandEncoder, view: GPUCanvasContext) {
      orb.buf.write(orb.scratch);
      pipeline
        .with(enc)
        .with(orb.bind)
        .withColorAttachment({
          view,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        })
        .draw(3);
    },
  };
}

export type VitalsCore = ReturnType<typeof createVitalsCore>;
