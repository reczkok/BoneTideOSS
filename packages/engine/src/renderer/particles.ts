/**
 * Billboard particles. The pool is split: the low range is written by GPU
 * emitters in the sim, the high range by CPU `emit()` through a staging
 * ring. Every frame a compute prepass integrates them, then stream-compacts
 * the live ones into an index list and an indirect draw count.
 */
import tgpu, { d, std, type TgpuRoot } from 'typegpu';
import { perlin2d } from '@typegpu/noise';
import { BUBBLES, GPU_PARTICLES, MAX_PARTICLES, PARTICLE_DENSITY, VAPOR, WELL } from '../config.ts';
import { hash11, quadCorner } from '../core/gpu.ts';
import { createKernel } from '../core/kernel.ts';
import { Particle, type ParticleBuffer, SHAPE } from '../core/schemas.ts';
import type { Env } from './env.ts';
import { PREMUL_BLEND } from './formats.ts';
import { camera, frameDt, fx } from './scene/bindings.ts';
import { meteorGust, novaGust, wellPull } from './scene/terrain.ts';

const BLOCK = PARTICLE_DENSITY.compactBlock;
const NBLOCKS = MAX_PARTICLES / BLOCK;
const CPU_RANGE = MAX_PARTICLES - GPU_PARTICLES;
const GROUND_Y = 0.02;

export interface ParticleSpec {
  pos: [number, number, number];
  vel: [number, number, number];
  color: [number, number, number];
  life: number;
  size: number;
  gravity: number;
  bounce: number;
  stretch?: number;
  glow?: number;
  home?: number;
  shape?: number;
}

const isShape = (shape: number, kind: number) => {
  'use gpu';
  return std.abs(shape - d.f32(kind)) < 0.5;
};

/** Sphere-cap height at radius `r` of a unit disc, for fake lighting on puffs. */
const capHeight = (r: number) => {
  'use gpu';
  return std.sqrt(std.max(1 - std.min(r, 1) * std.min(r, 1), 0));
};

const aliveLayout = tgpu.bindGroupLayout({
  particles: { storage: d.arrayOf(Particle), access: 'readonly' },
  alive: { storage: d.arrayOf(d.u32), access: 'readonly' },
});

const particleVert = tgpu.vertexFn({
  in: { vid: d.builtin.vertexIndex, iid: d.builtin.instanceIndex },
  out: {
    position: d.builtin.position,
    corner: d.vec2f,
    color: d.vec3f,
    alpha: d.f32,
    glow: d.f32,
    shape: d.f32,
    age: d.f32,
    seed: d.f32,
  },
})((input) => {
  'use gpu';
  const slot = aliveLayout.$.alive[input.iid];
  const p = aliveLayout.$.particles[slot];
  const c = quadCorner(input.vid);
  const t = std.clamp(p.life / p.maxLife, 0, 1);
  const age = 1 - t;
  let seed = std.fract(d.f32(slot) * 0.6180339);
  if (p.shape < 5.5) {
    seed = hash11(d.f32(slot));
  }
  let size = p.size * (0.55 + 0.45 * t);
  let wobble = d.vec2f();
  if (isShape(p.shape, SHAPE.BUBBLE)) {
    size = p.size * (1 + BUBBLES.grow * age);
    const ph = camera.$.time * BUBBLES.wobbleFreq * (0.8 + seed * 0.4) + seed * 6.2832;
    wobble = d.vec2f(std.sin(ph), 0.35 * std.sin(ph * 1.7 + 1.3)) * (size * BUBBLES.wobbleAmp);
  } else if (isShape(p.shape, SHAPE.RIPPLE)) {
    size = p.size * (0.5 + 1.8 * age);
  } else if (p.shape > 4.5) {
    size = p.size * (0.75 + 0.75 * age);
  }

  const vScreen = d.vec2f(std.dot(p.vel, camera.$.camRight), std.dot(p.vel, camera.$.camUp));
  const vLen = std.length(vScreen);
  let axisX = d.vec2f(1, 0);
  if (vLen > 0.15) {
    axisX = vScreen * (1 / vLen);
  }
  const axisY = d.vec2f(-axisX.y, axisX.x);
  const sx = size * (1 + p.stretch * vLen * 0.3);
  const off = axisX * (c.x * sx) + axisY * (c.y * size) + wobble;
  const wPos = p.pos + camera.$.camRight * off.x + camera.$.camUp * off.y;

  return {
    position: camera.$.viewProj * d.vec4f(wPos, 1),
    corner: c,
    color: p.color,
    alpha: std.clamp(t * 4, 0, 1),
    glow: p.glow,
    shape: p.shape,
    age,
    seed,
  };
});

const particleFrag = tgpu.fragmentFn({
  in: {
    corner: d.vec2f,
    color: d.vec3f,
    alpha: d.f32,
    glow: d.f32,
    shape: d.f32,
    age: d.f32,
    seed: d.f32,
  },
  out: d.vec4f,
})((input) => {
  'use gpu';
  const r = std.length(input.corner);
  if (r > 1) {
    std.discard();
  }
  if (isShape(input.shape, SHAPE.STEAM)) {
    const offset =
      (d.vec2f(input.seed, std.fract(input.seed * 7.13)) - 0.5) * (0.24 + input.age * 0.16);
    const qa = input.corner - offset;
    const qb = input.corner + d.vec2f(offset.y, -offset.x) * 0.8;
    const center = std.smoothstep(1, 0.15, r) * 0.75;
    const lobeA = std.smoothstep(0.42, 0.06, std.dot(qa, qa));
    const lobeB = std.smoothstep(0.36, 0.05, std.dot(qb, qb));
    const dens = std.max(center, std.max(lobeA, lobeB));
    const erode = 0.12 + input.age * 0.5;
    const body = std.smoothstep(erode, erode + 0.28, dens);
    const lit = 0.56 + 0.52 * std.max(input.corner.y * 0.55 + capHeight(r) * 0.4, 0);
    const a = body * input.alpha * std.smoothstep(0, 0.1, input.age);
    return d.vec4f(input.color * (lit * a), a * (1 - input.glow));
  }
  if (isShape(input.shape, SHAPE.VAPOR)) {
    const tt = camera.$.time * VAPOR.drift;
    const sd = input.seed * 43.7;
    const n1 = perlin2d.sample(input.corner * VAPOR.scale1 + d.vec2f(sd + tt, sd * 1.7 - tt * 0.7));
    const n2 = perlin2d.sample(
      input.corner * VAPOR.scale2 + d.vec2f(sd * 2.3 - tt * 1.4, sd * 0.9 + tt),
    );
    const dens = std.smoothstep(1, 0.15, r) * (0.6 + 0.45 * n1 + 0.25 * n2);
    const erode = VAPOR.erode0 + VAPOR.erodeRamp * input.age;
    const body = std.smoothstep(erode, erode + 0.35, dens);
    const lit =
      VAPOR.litBase +
      VAPOR.litGain * std.max(input.corner.y * 0.55 + capHeight(r) * 0.35 + n1 * 0.3, 0);
    const a = body * input.alpha * std.smoothstep(0, 0.12, input.age);
    return d.vec4f(input.color * (lit * a), a * (1 - input.glow));
  }
  if (isShape(input.shape, SHAPE.BUBBLE)) {
    const q = std.min(r * (1 / 0.9), 1);
    const nz = std.sqrt(std.max(1 - q * q, 0));
    const n = d.vec3f(input.corner * (1 / 0.9), nz);
    const disc = std.smoothstep(0.92, 0.84, r);
    const limb = std.pow(1 - nz, 1.4);
    const aBody = disc * BUBBLES.bodyAlpha * (0.15 + 0.85 * limb);
    const rim = std.pow(std.max(std.dot(n, d.vec3f(-0.45, 0.65, 0.61)), 0), 2) * limb;
    const glint = std.smoothstep(0.2, 0.03, std.distance(input.corner, d.vec2f(-0.3, 0.34)));
    const counter =
      std.smoothstep(0.16, 0.02, std.distance(input.corner, d.vec2f(0.24, -0.28))) * 0.25;
    const glintCol = input.color * 0.8 + d.vec3f(1.1, 1.3, 0.9);
    let rgb = input.color * (BUBBLES.bodyTint * aBody);
    rgb += input.color * (rim * BUBBLES.rimGain * disc);
    rgb += glintCol * ((glint + counter) * BUBBLES.glintGain * disc * nz);
    return d.vec4f(rgb * input.alpha, aBody * input.alpha);
  }
  let m = std.smoothstep(1, 0.5, r);
  if (isShape(input.shape, SHAPE.RIPPLE)) {
    const rr = 0.25 + 0.7 * input.age;
    const th = 0.16 - 0.1 * input.age;
    m = std.smoothstep(th, th * 0.2, std.abs(r - rr)) * (1 - input.age * input.age);
  } else if (isShape(input.shape, SHAPE.RING)) {
    const core = std.smoothstep(0.5, 0.08, r);
    const ring = std.smoothstep(0.16, 0.02, std.abs(r - 0.72));
    m = core + ring * 0.7;
  } else if (isShape(input.shape, SHAPE.STAR)) {
    const spikeX =
      std.pow(std.max(0, 1 - std.abs(input.corner.y)), 10) * (1 - std.abs(input.corner.x));
    const spikeZ =
      std.pow(std.max(0, 1 - std.abs(input.corner.x)), 10) * (1 - std.abs(input.corner.y));
    m = std.smoothstep(0.4, 0.05, r) + (spikeX + spikeZ) * 0.9;
  }
  const a = m * input.alpha;
  return d.vec4f(input.color * a, a * (1 - input.glow));
});

export function createParticlePass(root: TgpuRoot, env: Env, particleBuf: ParticleBuffer) {
  const particles = particleBuf.as('mutable');
  const aliveBuf = root.createBuffer(d.arrayOf(d.u32, MAX_PARTICLES)).$usage('storage');
  const alive = aliveBuf.as('mutable');
  const blockOffsets = root.createMutable(d.arrayOf(d.u32, NBLOCKS));
  const drawArgsBuf = root.createBuffer(d.vec4u, [6, 0, 0, 0]).$usage('storage', 'indirect');
  const drawArgs = drawArgsBuf.as('mutable');

  const integrate = createKernel(env.gpu, [MAX_PARTICLES], (i: number) => {
    'use gpu';
    if (particles.$[i].life <= 0) {
      return;
    }
    let p = std.copy(particles.$[i]);
    const dt = frameDt.$;
    let vel = p.vel * std.exp(-1.6 * dt);
    vel.y -= p.gravity * dt;
    p.life -= dt;

    if (p.home > 0) {
      const to = d.vec3f(fx.$.playerPos.x, 1.0, fx.$.playerPos.y) - p.pos;
      const dist = std.length(to);
      if (dist > 0.001) {
        vel = (vel + to * ((p.home * 42 * dt) / dist)) * std.exp(-2.4 * dt);
      }
      if (dist < 0.55) {
        p.life = std.min(p.life, 0.07);
      }
    }
    const gust = novaGust(p.pos.xz) + meteorGust(p.pos.xz);
    const gustLen = std.length(gust);
    if (gustLen > 0.001) {
      vel += d.vec3f(gust.x, gustLen * 0.4, gust.y) * (26 * dt);
    }
    const pull = wellPull(p.pos.xz);
    const pullLen = std.length(pull);
    if (pullLen > 0.001) {
      vel += d.vec3f(pull.x, pullLen * 0.25, pull.y) * (WELL.particlePull * dt);
    }

    p.pos += vel * dt;
    if (p.pos.y < GROUND_Y && vel.y < 0) {
      p.pos.y = GROUND_Y;
      vel = d.vec3f(vel.x * 0.6, -vel.y * p.bounce, vel.z * 0.6);
      if (p.bounce === 0) {
        vel = d.vec3f();
      }
    }
    p.vel = d.vec3f(vel);
    particles.$[i] = std.copy(p);
  });

  const countBlocks = createKernel(env.gpu, [NBLOCKS], (b: number) => {
    'use gpu';
    const start = d.u32(b) * d.u32(BLOCK);
    let n = d.u32(0);
    for (const k of std.range(BLOCK)) {
      if (particles.$[start + d.u32(k)].life > 0) {
        n += 1;
      }
    }
    blockOffsets.$[b] = n;
  });
  const scanBlocks = createKernel(env.gpu, [1], () => {
    'use gpu';
    let sum = d.u32(0);
    for (const b of std.range(NBLOCKS)) {
      const c = blockOffsets.$[b];
      blockOffsets.$[b] = sum;
      sum += c;
    }
    drawArgs.$ = d.vec4u(6, sum, 0, 0);
  });
  const scatterAlive = createKernel(env.gpu, [NBLOCKS], (b: number) => {
    'use gpu';
    const start = d.u32(b) * d.u32(BLOCK);
    let o = blockOffsets.$[b];
    for (const k of std.range(BLOCK)) {
      const i = start + d.u32(k);
      if (particles.$[i].life > 0) {
        alive.$[o] = i;
        o += 1;
      }
    }
  });

  const pipeline = env.gpu
    .createRenderPipeline({
      vertex: particleVert,
      fragment: particleFrag,
      targets: { format: env.format, blend: PREMUL_BLEND },
      primitive: { topology: 'triangle-list' },
      ...env.sceneDepth(false),
    })
    .with(root.createBindGroup(aliveLayout, { particles: particleBuf, alive: aliveBuf }));

  // CPU emits land in a ring over the high half of the pool. Specs are packed
  // straight into a byte-exact staging copy and flushed once per frame.
  const STRIDE_B = d.sizeOf(Particle);
  const STRIDE_F = STRIDE_B / 4;
  const floatOffset = (key: keyof typeof Particle.propTypes) =>
    d.memoryLayoutOf(Particle, (p) => p[key]).offset / 4;
  const OFF = {
    pos: floatOffset('pos'),
    vel: floatOffset('vel'),
    color: floatOffset('color'),
    life: floatOffset('life'),
    maxLife: floatOffset('maxLife'),
    size: floatOffset('size'),
    gravity: floatOffset('gravity'),
    bounce: floatOffset('bounce'),
    stretch: floatOffset('stretch'),
    glow: floatOffset('glow'),
    home: floatOffset('home'),
    shape: floatOffset('shape'),
  };
  const staging = new Float32Array(STRIDE_F * CPU_RANGE);
  const CPU_BASE_B = GPU_PARTICLES * STRIDE_B;
  let cursor = 0;
  let cpuHigh = 0;
  let cpuClock = 0;
  let cpuLastExpiry = 0;
  let pendingStart = 0;
  let pendingCount = 0;

  const upload = (first: number, count: number) => {
    root.device.queue.writeBuffer(
      particleBuf.buffer,
      CPU_BASE_B + first * STRIDE_B,
      staging.buffer,
      first * STRIDE_B,
      count * STRIDE_B,
    );
  };
  const flushEmits = () => {
    if (pendingCount === 0) return;
    if (pendingCount >= CPU_RANGE) {
      upload(0, CPU_RANGE);
    } else if (pendingStart + pendingCount <= CPU_RANGE) {
      upload(pendingStart, pendingCount);
    } else {
      const head = CPU_RANGE - pendingStart;
      upload(pendingStart, head);
      upload(0, pendingCount - head);
    }
    pendingStart = cursor;
    pendingCount = 0;
  };

  return {
    emit(specs: readonly ParticleSpec[]) {
      const n = specs.length;
      if (n === 0) return;
      const start = cursor;
      for (const s of specs) {
        const base = cursor * STRIDE_F;
        staging.set(s.pos, base + OFF.pos);
        staging.set(s.vel, base + OFF.vel);
        staging.set(s.color, base + OFF.color);
        staging[base + OFF.life] = s.life;
        staging[base + OFF.maxLife] = s.life;
        staging[base + OFF.size] = s.size;
        staging[base + OFF.gravity] = s.gravity;
        staging[base + OFF.bounce] = s.bounce;
        staging[base + OFF.stretch] = s.stretch ?? 0;
        staging[base + OFF.glow] = s.glow ?? 0;
        staging[base + OFF.home] = s.home ?? 0;
        staging[base + OFF.shape] = s.shape ?? 0;
        cursor = (cursor + 1) % CPU_RANGE;
        cpuLastExpiry = Math.max(cpuLastExpiry, cpuClock + s.life + 0.1);
      }
      cpuHigh = start + n > CPU_RANGE ? CPU_RANGE : Math.max(cpuHigh, start + n);
      pendingCount = Math.min(pendingCount + n, CPU_RANGE);
    },
    update(pass: GPUComputePassEncoder, dt: number) {
      flushEmits();
      cpuClock += dt;
      if (cpuHigh > 0 && cpuClock > cpuLastExpiry) {
        cpuHigh = 0;
        cursor = 0;
      }
      integrate.run(pass);
      countBlocks.run(pass);
      scanBlocks.run(pass);
      scatterAlive.run(pass);
    },
    reset() {
      particleBuf.clear();
      drawArgsBuf.write([6, 0, 0, 0]);
      cursor = 0;
      cpuHigh = 0;
      cpuLastExpiry = 0;
      pendingStart = 0;
      pendingCount = 0;
    },
    draw(pass: GPURenderPassEncoder) {
      pipeline.with(pass).drawIndirect(drawArgsBuf.buffer, 0);
    },
  };
}
