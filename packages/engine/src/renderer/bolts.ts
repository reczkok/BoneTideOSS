/**
 * Chain-lightning bolts: a strike from the sky into the first node, then
 * one jagged multi-strand ribbon per hop between chain nodes.
 */
import tgpu, { d, std } from 'typegpu';
import { perlin2d } from '@typegpu/noise';
import { CHAIN } from '../config.ts';
import { CULLED_CLIP, quadCorner } from '../core/gpu.ts';
import type { ChainBuffer } from '../core/schemas.ts';
import type { Env } from './env.ts';
import { PREMUL_BLEND } from './formats.ts';
import { camera } from './scene/bindings.ts';
import { viewDirTo } from './scene/lighting.ts';

const BOLT_SUBDIV = 12;
const BOLT_STRANDS = 4;
const STRAND_WIDTH = tgpu.const(d.arrayOf(d.f32, BOLT_STRANDS), [0.17, 0.09, 0.09, 0.5]);
const STRAND_ALPHA = tgpu.const(d.arrayOf(d.f32, BOLT_STRANDS), [1, 0.75, 0.75, 0.22]);
const STRAND_COLOR = tgpu.const(d.arrayOf(d.vec3f, BOLT_STRANDS), [
  d.vec3f(3.2, 3.6, 4.4),
  d.vec3f(1.2, 1.7, 3.1),
  d.vec3f(1.2, 1.7, 3.1),
  d.vec3f(0.55, 0.85, 1.8),
]);

export function createBoltPass(env: Env, chainBuf: ChainBuffer) {
  const chain = chainBuf.as('readonly');

  const boltVert = tgpu.vertexFn({
    in: { vid: d.builtin.vertexIndex, iid: d.builtin.instanceIndex },
    out: { position: d.builtin.position, edge: d.f32, color: d.vec3f, alpha: d.f32 },
  })((input) => {
    'use gpu';
    const seg = d.u32(input.iid / BOLT_STRANDS);
    const strand = input.iid - seg * BOLT_STRANDS;
    const c = chain.$;
    const age = camera.$.time - c.time;
    if (c.count < 2 || seg >= c.count || age < 0 || age > CHAIN.boltLife) {
      return { position: CULLED_CLIP, edge: d.f32(0), color: d.vec3f(), alpha: d.f32(0) };
    }

    let a = d.vec3f();
    let b = d.vec3f();
    let ampScale = d.f32(1);
    if (seg === 0) {
      const first = c.nodes[1];
      a = d.vec3f(first.x + 2.5, 15, first.y - 1.5);
      b = d.vec3f(first.x, 0.4, first.y);
      ampScale = 1.9;
    } else {
      a = d.vec3f(c.nodes[seg - 1].x, 1.1, c.nodes[seg - 1].y);
      b = d.vec3f(c.nodes[seg].x, 1.1, c.nodes[seg].y);
    }

    const piece = d.u32(input.vid / 6);
    const corner = quadCorner(input.vid);
    const s = (d.f32(piece) + corner.x * 0.5 + 0.5) / BOLT_SUBDIV;

    const seg3 = b - a;
    const dirN = seg3 * (1 / std.max(std.length(seg3), 1e-4));
    let u = std.cross(dirN, d.vec3f(0, 1, 0));
    if (std.length(u) < 0.1) {
      u = d.vec3f(1, 0, 0);
    }
    u = std.normalize(u);
    const v = std.cross(dirN, u);

    const t = camera.$.time;
    const envelope = std.sin(s * 3.14159);
    const n1 = perlin2d.sample(d.vec2f(s * 7 + d.f32(strand) * 17.3, t * 25 + d.f32(seg) * 9.1));
    const n2 = perlin2d.sample(d.vec2f(s * 9 - t * 21, d.f32(strand) * 7.7 + d.f32(seg) * 3.3));
    const amp = envelope * (0.35 + d.f32(strand) * 0.22) * ampScale;
    let wPos = std.mix(a, b, s) + u * (n1 * amp) + v * (n2 * amp * 0.8);
    if (seg > 0) {
      wPos.y += envelope * 0.45;
    }
    const across = std.normalize(std.cross(dirN, viewDirTo(wPos)));
    const wOut = wPos + across * (corner.y * STRAND_WIDTH.$[strand]);
    const flicker = 0.7 + 0.3 * std.sin(t * 57 + d.f32(seg) * 5.1);
    return {
      position: camera.$.viewProj * d.vec4f(wOut, 1),
      edge: corner.y,
      color: STRAND_COLOR.$[strand],
      alpha: std.exp(-age * 6) * flicker * STRAND_ALPHA.$[strand],
    };
  });

  const boltFrag = tgpu.fragmentFn({
    in: { edge: d.f32, color: d.vec3f, alpha: d.f32 },
    out: d.vec4f,
  })((input) => {
    'use gpu';
    const a = std.smoothstep(1, 0.15, std.abs(input.edge)) * input.alpha;
    return d.vec4f(input.color * a, 0);
  });

  const pipeline = env.gpu.createRenderPipeline({
    vertex: boltVert,
    fragment: boltFrag,
    targets: { format: env.format, blend: PREMUL_BLEND },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    ...env.sceneDepth(false),
  });

  return {
    draw(pass: GPURenderPassEncoder) {
      pipeline.with(pass).draw(6 * BOLT_SUBDIV, CHAIN.maxNodes * BOLT_STRANDS);
    },
  };
}
