/**
 * Night-time fireflies: a GPU-wandered swarm of glowing billboards that
 * scatter from the player and get zapped by chain lightning, plus four
 * roaming point lights that stand in for the swarm's glow.
 */
import tgpu, { d, std, type TgpuRoot } from 'typegpu';
import { perlin2d } from '@typegpu/noise';
import { ARENA_RADIUS, CHAIN } from '../config.ts';
import { CULLED_CLIP, quadCorner } from '../core/gpu.ts';
import { createKernel } from '../core/kernel.ts';
import { type ChainBuffer, Firefly, FIREFLY_COUNT } from '../core/schemas.ts';
import type { Env } from './env.ts';
import { PREMUL_BLEND } from './formats.ts';
import type { SteadyLightSpec } from './lights.ts';
import { camera, frameDt, fx, lighting } from './scene/bindings.ts';
import { windAt } from './scene/terrain.ts';

const NIGHT_MIN = 0.03;
const SWARM_LIGHTS = 4;
type MutableSteadyLightSpec = SteadyLightSpec & { color: [number, number, number] };

const seedFireflies = (): d.InferInput<typeof Firefly>[] =>
  Array.from({ length: FIREFLY_COUNT }, () => {
    const a = Math.random() * Math.PI * 2;
    const r = 7 + Math.random() * (ARENA_RADIUS - 2);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    return { pos: [x, 0.5 + Math.random() * 1.2, z], home: [x, z], phase: Math.random(), zapT: 0 };
  });

export function createFireflyPass(root: TgpuRoot, env: Env, chainBuf: ChainBuffer) {
  const flyBuf = root
    .createBuffer(d.arrayOf(Firefly, FIREFLY_COUNT), seedFireflies())
    .$usage('storage');
  const writableFlies = flyBuf.as('mutable');
  const readonlyFlies = flyBuf.as('readonly');
  const chain = chainBuf.as('readonly');

  const wander = createKernel(env.gpu, [FIREFLY_COUNT], (i: number) => {
    'use gpu';
    const f = writableFlies.$[i];
    const dt = frameDt.$;
    const t = camera.$.time;

    if (f.zapT > 0) {
      writableFlies.$[i].zapT = f.zapT - dt;
      return;
    }
    const chainAge = t - fx.$.chainStart;
    if (chainAge >= 0 && chainAge < 0.4) {
      for (const k of std.range(CHAIN.maxNodes)) {
        if (d.u32(k) >= chain.$.count) break;
        if (std.distance(f.pos.xz, chain.$.nodes[k]) < 3) {
          writableFlies.$[i].zapT = 2 + f.phase * 2;
          return;
        }
      }
    }

    const ang =
      perlin2d.sample(f.pos.xz * 0.18 + d.vec2f(t * 0.05, -t * 0.04)) * 6.2831853 + f.phase * 6.283;
    let v = d.vec2f(std.cos(ang), std.sin(ang)) * 0.55;
    const toHome = f.home - f.pos.xz;
    if (std.length(toHome) > 4) {
      v += toHome * 0.25;
    }
    const away = f.pos.xz - fx.$.playerPos;
    const dp = std.length(away);
    if (dp < 2.5 && dp > 1e-3) {
      v += away * ((1 / dp) * (2.5 - dp) * 2.2);
    }
    v += windAt(f.pos.xz) * 6;

    const targetY = 0.75 + std.sin(t * 0.9 + f.phase * 12) * 0.4;
    const y = f.pos.y + (targetY - f.pos.y) * std.min(1, dt * 2);
    writableFlies.$[i].pos = d.vec3f(f.pos.x + v.x * dt, y, f.pos.z + v.y * dt);
  });

  const flyVert = tgpu.vertexFn({
    in: { vid: d.builtin.vertexIndex, iid: d.builtin.instanceIndex },
    out: { position: d.builtin.position, corner: d.vec2f, glow: d.f32 },
  })((input) => {
    'use gpu';
    const f = readonlyFlies.$[input.iid];
    const night = lighting.$.nightFactor;
    if (f.zapT > 0 || night < NIGHT_MIN) {
      return { position: CULLED_CLIP, corner: d.vec2f(), glow: d.f32(0) };
    }
    const c = quadCorner(input.vid);
    const pulse = 0.35 + 0.65 * std.max(0, std.sin(camera.$.time * 2.3 + f.phase * 40));
    const size = 0.05 + 0.03 * pulse;
    const wPos = f.pos + camera.$.camRight * (c.x * size) + camera.$.camUp * (c.y * size);
    return { position: camera.$.viewProj * d.vec4f(wPos, 1), corner: c, glow: night * pulse };
  });

  const flyFrag = tgpu.fragmentFn({
    in: { corner: d.vec2f, glow: d.f32 },
    out: d.vec4f,
  })((input) => {
    'use gpu';
    const a = std.smoothstep(1, 0.25, std.length(input.corner)) * input.glow;
    return d.vec4f(d.vec3f(1.5, 1.25, 0.4) * a, 0);
  });

  const pipeline = env.gpu.createRenderPipeline({
    vertex: flyVert,
    fragment: flyFrag,
    targets: { format: env.format, blend: PREMUL_BLEND },
    primitive: { topology: 'triangle-list' },
    ...env.sceneDepth(false),
  });

  let lightTime = 0;
  const swarmLights: MutableSteadyLightSpec[] = Array.from({ length: SWARM_LIGHTS }, () => ({
    x: 0,
    y: 1.2,
    z: 0,
    color: [0, 0, 0],
    radius: 8,
  }));

  return {
    update(dt: number, pass: GPUComputePassEncoder) {
      const night = env.nightFactor();
      if (night >= NIGHT_MIN) wander.run(pass);
      lightTime += dt;
      swarmLights.forEach((s, k) => {
        if (night <= 0.15) {
          env.setSteadyLight(`flies${k}`, null);
          return;
        }
        const ang =
          k * (Math.PI / 2) + lightTime * 0.06 + Math.sin(lightTime * 0.31 + k * 2.1) * 0.5;
        const r = ARENA_RADIUS * 0.6 + Math.sin(lightTime * 0.21 + k * 1.7) * 6;
        const glow = night * (0.75 + 0.25 * Math.sin(lightTime * 0.9 + k * 2.4));
        s.x = Math.cos(ang) * r;
        s.z = Math.sin(ang) * r;
        s.color[0] = 0.55 * glow;
        s.color[1] = 0.45 * glow;
        s.color[2] = 0.14 * glow;
        env.setSteadyLight(`flies${k}`, s);
      });
    },
    draw(pass: GPURenderPassEncoder) {
      if (env.nightFactor() < NIGHT_MIN) return;
      pipeline.with(pass).draw(6, FIREFLY_COUNT);
    },
  };
}
