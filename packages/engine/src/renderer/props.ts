/**
 * Static and live props: scattered foliage and rocks, the falling meteor,
 * boss boulders and ice spikes. One instanced mesh batch per prop kind, a
 * per-instance compute prep for bend/burn/flood state, indirect draws so
 * empty batches are free, and the scene draws replayed from a bundle.
 */
import tgpu, { d, std, type StorageFlag, type TgpuBuffer, type TgpuRoot } from 'typegpu';
import type { GameAssets, PropAssets } from '../assets/assets.ts';
import { BOSS, FIRE, FOLIAGE, MAX_SPIKE_ROCKS, TRAMPLE_CELLS, TRAMPLE_HALF } from '../config.ts';
import { hash11, rotateY } from '../core/gpu.ts';
import { createIndirectArgs } from '../core/indirect.ts';
import { PropInstance, PropVertex, type TrampleBuffer } from '../core/schemas.ts';
import type { WorldScatter } from '../core/world.ts';
import { fieldCoord, inField, INV_FP } from '../sim/field.ts';
import type { Env } from './env.ts';
import { SHADOW_DEPTH_STENCIL } from './formats.ts';
import { iceRockShade } from './materials/ice.ts';
import { camera, fieldA, fx, lighting, lightVP, linearSampler } from './scene/bindings.ts';
import { shade, viewDirTo } from './scene/lighting.ts';
import { groundHeight, meteorGust, novaGust, wellPull } from './scene/terrain.ts';
import { TG_COLOR, telegraphGlow, telegraphMask } from './scene/telegraph.ts';

export interface PropInstanceSpec {
  pos: [number, number, number];
  rotCS: [number, number];
  scale: number;
  sway: number;
}

const PropState = d.struct({
  bendK: d.vec2f,
  groundY: d.f32,
  burn: d.f32,
  heat: d.f32,
  wet: d.f32,
  tele: d.f32,
});

type PropInstanceBuffer = TgpuBuffer<d.WgslArray<typeof PropInstance>> & StorageFlag;

const PREP_WG = 64;
const GRASS_CULL_MARGIN = 3;
const HIDDEN: PropInstanceSpec = { pos: [0, -100, 0], rotCS: [1, 0], scale: 0, sway: 0 };
const ICE_TINT: [number, number, number, number] = [0.88, 0.94, 1.02, 1];
const WHITE_TINT: [number, number, number, number] = [1, 1, 1, 0];
const TRAMPLE_CELL_INV = TRAMPLE_CELLS / (TRAMPLE_HALF * 2);

/** Props with any sway are foliage: they burn, flood and bend; rocks do not. */
const flammability = (sway: number) => {
  'use gpu';
  return std.clamp(sway * 9, 0, 1);
};

const drawLayout = tgpu.bindGroupLayout({
  instances: { storage: d.arrayOf(PropInstance), access: 'readonly' },
  state: { storage: d.arrayOf(PropState), access: 'readonly' },
  rangeStart: { uniform: d.u32 },
  /** rgb tint; w blends in the ice-rock material. */
  tint: { uniform: d.vec4f },
});

const prepLayout = tgpu.bindGroupLayout({
  instances: { storage: d.arrayOf(PropInstance), access: 'readonly' },
  state: { storage: d.arrayOf(PropState), access: 'mutable' },
  count: { uniform: d.u32 },
  start: { uniform: d.u32 },
});

const texLayout = tgpu.bindGroupLayout({
  tex: { texture: d.texture2d(d.f32) },
});

/** Local mesh position → world, applying scale, burn shrink, flooding, sway and bend. */
const propWorldPos = (iid: number, local: d.v3f, st: d.InferGPU<typeof PropState>) => {
  'use gpu';
  const inst = drawLayout.$.instances[iid];
  const flammable = flammability(inst.sway);
  let p = local * inst.scale;
  if (flammable > 0.01) {
    p = p * (1 - st.burn * 0.55 * flammable);
    if (lighting.$.waterOn === 1) {
      const submerge = std.min(st.wet * FOLIAGE.floodSubmerge, FOLIAGE.floodSubmergeMax);
      p = p * (1 - submerge * flammable);
    }
  }
  const sway = std.sin(camera.$.time * 1.7 + inst.pos.x * 0.9 + inst.pos.z * 0.7) * inst.sway * p.y;
  const drop = p.y * std.dot(st.bendK, st.bendK) * (1 / (2 * FOLIAGE.maxBendPerHeight));
  const lean = d.vec3f(sway + st.bendK.x * p.y, st.groundY - drop, sway * 0.6 + st.bendK.y * p.y);
  return inst.pos + rotateY(p, inst.rotCS) + lean;
};

const propVert = tgpu.vertexFn({
  in: { position: d.vec3f, normal: d.vec4f, uv: d.vec2f, iid: d.builtin.instanceIndex },
  out: {
    position: d.builtin.position,
    wNormal: d.vec3f,
    fragUv: d.vec2f,
    wPos: d.vec3f,
    shadeMul: d.f32,
    fireGlow: d.f32,
    localH: d.f32,
    tele: d.f32,
    teleFragW: d.f32,
  },
})((input) => {
  'use gpu';
  const idx = drawLayout.$.rangeStart + input.iid;
  const inst = drawLayout.$.instances[idx];
  const st = drawLayout.$.state[idx];
  const wPos = propWorldPos(idx, input.position, st);
  const localY = input.position.y * inst.scale;
  const ao = 0.58 + 0.42 * std.smoothstep(0.02, 0.85, localY);
  const seed = hash11(d.f32(idx));
  const flammable = flammability(inst.sway);
  const tint = 1 + (seed - 0.45) * 0.5 * std.clamp(inst.sway * 9, 0.12, 1);
  const burnDark = 1 - st.burn * 0.7 * flammable;
  const flicker = 0.6 + 0.4 * std.sin(camera.$.time * 13 + seed * 47);
  return {
    position: camera.$.viewProj * d.vec4f(wPos, 1),
    wNormal: rotateY(input.normal.xyz, inst.rotCS),
    fragUv: input.uv,
    wPos,
    shadeMul: ao * tint * burnDark,
    fireGlow: st.heat * flammable * flicker,
    localH: localY,
    tele: st.tele,
    teleFragW: 1 - flammable,
  };
});

const propFrag = tgpu.fragmentFn({
  in: {
    wNormal: d.vec3f,
    fragUv: d.vec2f,
    wPos: d.vec3f,
    shadeMul: d.f32,
    fireGlow: d.f32,
    localH: d.f32,
    tele: d.f32,
    teleFragW: d.f32,
    front: d.builtin.frontFacing,
  },
  out: d.vec4f,
})((input) => {
  'use gpu';
  const albedo = std.textureSample(texLayout.$.tex, linearSampler.$, input.fragUv);
  const n = std.select(input.wNormal * -1, input.wNormal, input.front);
  const look = drawLayout.$.tint;
  let color = shade(albedo.rgb * look.xyz * input.shadeMul, n, input.wPos, d.f32(0));
  if (look.w > 0.001) {
    const nn = std.normalize(n);
    color = iceRockShade(color, nn, viewDirTo(input.wPos), input.wPos, input.localH, look.w);
  }
  color += d.vec3f(2.4, 0.75, 0.12) * input.fireGlow;
  color += TG_COLOR * input.tele;
  if (input.teleFragW > 0.001) {
    color += telegraphGlow(input.wPos.xz) * input.teleFragW;
  }
  return d.vec4f(color, 1);
});

const propShadowVert = tgpu.vertexFn({
  in: { position: d.vec3f, iid: d.builtin.instanceIndex },
  out: { position: d.builtin.position },
})((input) => {
  'use gpu';
  const idx = drawLayout.$.rangeStart + input.iid;
  const wPos = propWorldPos(idx, input.position, drawLayout.$.state[idx]);
  return { position: lightVP.$ * d.vec4f(wPos, 1) };
});

const propVertLayout = tgpu.vertexLayout(d.disarrayOf(PropVertex));

/** First index past the last visible instance, so trailing hidden slots are not drawn. */
const visibleCount = (instances: readonly PropInstanceSpec[]) => {
  for (let i = instances.length - 1; i >= 0; i--) {
    if (instances[i].scale > 0) return i + 1;
  }
  return 0;
};

/** Index range of an ascending array whose values fall inside [min, max]. */
const sortedRange = (zs: Float32Array, min: number, max: number) => {
  const lowerBound = (v: number, from: number) => {
    let lo = from;
    let hi = zs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (zs[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const first = lowerBound(min, 0);
  return { first, count: lowerBound(max + 1e-6, first) - first };
};

export function createPropPass(
  root: TgpuRoot,
  env: Env,
  assets: GameAssets,
  scatter: WorldScatter,
  trampleBuf: TrampleBuffer,
) {
  const trample = root.createReadonly(
    d.arrayOf(d.vec2i, TRAMPLE_CELLS * TRAMPLE_CELLS),
    trampleBuf.buffer,
  );

  /** Bend from the player pushing through, trampling enemies and ability winds. */
  const bendAt = (rootP: d.v2f, sway: number) => {
    'use gpu';
    let bend = d.vec2f();
    const away = rootP - fx.$.playerPos;
    const dp = std.length(away);
    if (dp > 1e-3 && dp < FOLIAGE.playerRadius) {
      const push = std.smoothstep(FOLIAGE.playerRadius, 0.25, dp) * FOLIAGE.playerBend;
      bend += away * (push / dp);
    }
    const cell = d.vec2i((rootP + TRAMPLE_HALF) * TRAMPLE_CELL_INV);
    if (cell.x >= 0 && cell.x < TRAMPLE_CELLS && cell.y >= 0 && cell.y < TRAMPLE_CELLS) {
      const f = d.vec2f(trample.$[cell.y * TRAMPLE_CELLS + cell.x]) * INV_FP;
      const fl = std.length(f);
      if (fl > 0.02) {
        bend += f * ((std.min(fl, 1.4) * FOLIAGE.trampleBend) / fl);
      }
    }
    bend += meteorGust(rootP) * FOLIAGE.meteorBend;
    bend += novaGust(rootP) * FOLIAGE.novaBend;
    bend += wellPull(rootP) * FOLIAGE.wellBend;
    let bendK = d.vec2f();
    const bl = std.length(bend);
    if (bl > 1e-4) {
      const k = FOLIAGE.maxBendPerHeight * std.tanh((bl * sway) / FOLIAGE.maxBendPerHeight);
      bendK = bend * (k / bl);
    }
    return bendK;
  };

  const propPrep = tgpu.computeFn({
    workgroupSize: [PREP_WG],
    in: { gid: d.builtin.globalInvocationId },
  })((input) => {
    'use gpu';
    const i = input.gid.x + prepLayout.$.start;
    if (i >= prepLayout.$.count) {
      return;
    }
    const inst = prepLayout.$.instances[i];
    const rootP = inst.pos.xz;
    const flammable = flammability(inst.sway);
    let fire = d.vec3f();
    let tele = d.f32(0);
    if (flammable > 0.01) {
      const cell = fieldCoord(rootP);
      if (inField(cell)) {
        const t = std.textureLoad(fieldA.$, cell, 0);
        fire = d.vec3f(std.clamp(1 - t.x / FIRE.fuelInit + t.y * 0.4, 0, 1), t.y, t.z);
      }
      tele = telegraphMask(rootP) * flammable;
    }
    let bendK = d.vec2f();
    if (inst.sway > 0.001) {
      bendK = bendAt(rootP, inst.sway);
    }
    prepLayout.$.state[i] = PropState({
      bendK,
      groundY: groundHeight(rootP),
      burn: fire.x,
      heat: fire.y,
      wet: fire.z,
      tele,
    });
  });
  const prepPipeline = env.gpu.createComputePipeline({ compute: propPrep });

  const scenePipeline = env.gpu.createRenderPipeline({
    attribs: { ...propVertLayout.attrib },
    vertex: propVert,
    fragment: propFrag,
    targets: { format: env.format },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    ...env.sceneDepth(true),
  });
  const shadowPipeline = env.gpu.createRenderPipeline({
    attribs: { ...propVertLayout.attrib },
    vertex: propShadowVert,
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: SHADOW_DEPTH_STENCIL,
  });
  const forestBind = root.createBindGroup(texLayout, { tex: assets.forestTex });
  const whiteTint = root.createBuffer(d.vec4f, WHITE_TINT).$usage('uniform');
  const zeroStart = root.createBuffer(d.u32, 0).$usage('uniform');

  interface BatchOptions {
    castsShadow: boolean;
    tint?: [number, number, number, number] | undefined;
    /** Set for z-sorted batches that draw only the window inside the view. */
    zSorted?: Float32Array | undefined;
    /** Set for batches whose visible count is driven from the CPU. */
    live?: { count: number } | undefined;
  }

  const makeBatch = (
    mesh: PropAssets,
    instances: PropInstanceBuffer,
    capacity: number,
    opts: BatchOptions,
  ) => {
    const state = root.createBuffer(d.arrayOf(PropState, capacity)).$usage('storage');
    const count = root.createBuffer(d.u32, capacity).$usage('uniform');
    const tint = opts.tint ? root.createBuffer(d.vec4f, opts.tint).$usage('uniform') : whiteTint;
    const rangeStart = opts.zSorted ? root.createBuffer(d.u32, 0).$usage('uniform') : zeroStart;
    const drawBind = root.createBindGroup(drawLayout, { instances, state, tint, rangeStart });
    const prepBind = root.createBindGroup(prepLayout, {
      instances,
      state,
      count,
      start: rangeStart,
    });
    return {
      ...opts,
      capacity,
      indexCount: mesh.indexCount,
      rangeStart,
      scene: scenePipeline
        .with(propVertLayout, mesh.vertexBuf)
        .with(drawBind)
        .with(forestBind)
        .withIndexBuffer(mesh.indexBuf),
      shadow: shadowPipeline
        .with(propVertLayout, mesh.vertexBuf)
        .with(drawBind)
        .withIndexBuffer(mesh.indexBuf),
      prep: prepPipeline.with(prepBind),
    };
  };
  const batches: ReturnType<typeof makeBatch>[] = [];

  for (const [name, placements] of scatter) {
    const mesh = assets.props.get(name);
    if (!mesh || placements.length === 0) continue;
    const isGrass = name.startsWith('Grass');
    const ordered = isGrass ? [...placements].sort((a, b) => a.pos[2] - b.pos[2]) : placements;
    const instances = root
      .createBuffer(d.arrayOf(PropInstance, ordered.length), ordered)
      .$usage('storage');
    batches.push(
      makeBatch(mesh, instances, ordered.length, {
        castsShadow: !isGrass,
        zSorted: isGrass ? Float32Array.from(ordered, (p) => p.pos[2]) : undefined,
      }),
    );
  }

  /** A CPU-driven batch whose instances are rewritten wholesale on each update. */
  const makeLiveBatch = (
    mesh: PropAssets | undefined,
    capacity: number,
    tint?: [number, number, number, number],
  ) => {
    const hidden = Array.from({ length: capacity }, () => HIDDEN);
    const instances = root
      .createBuffer(d.arrayOf(PropInstance, capacity), hidden)
      .$usage('storage');
    const live = { count: 0 };
    if (mesh) batches.push(makeBatch(mesh, instances, capacity, { castsShadow: true, live, tint }));
    return (specs: readonly PropInstanceSpec[]) => {
      const full = specs.length === capacity;
      instances.write(full ? (specs as PropInstanceSpec[]) : hidden);
      live.count = full ? visibleCount(specs) : 0;
    };
  };
  const rock = assets.props.get('Rock_3_F') ?? assets.props.get('Rock_2_C');
  const writeMeteor = makeLiveBatch(assets.props.get('Rock_2_C'), 1);
  const writeBoulders = makeLiveBatch(rock, BOSS.boulder.maxInFlight);
  const writeSpikeRocks = makeLiveBatch(rock, MAX_SPIKE_ROCKS, ICE_TINT);
  const meteorSpec: PropInstanceSpec = { pos: [0, -100, 0], rotCS: [1, 0], scale: 1.5, sway: 0 };
  const meteorSpecs = [meteorSpec];

  const drawArgs = createIndirectArgs(
    root,
    batches.map((b) => ({
      indexCount: b.indexCount,
      instanceCount: b.zSorted || b.live ? 0 : b.capacity,
    })),
  );
  const drawAll = (pass: GPURenderPassEncoder | GPURenderBundleEncoder, shadow: boolean) => {
    batches.forEach((b, i) => {
      if (shadow && !b.castsShadow) return;
      const chain = shadow ? b.shadow : b.scene;
      chain
        .with(pass as GPURenderPassEncoder)
        .drawIndexedIndirect(drawArgs.buffer, drawArgs.offsetOf(i));
    });
  };
  const sceneBundle = env.bundle((be) => drawAll(be, false));

  let viewMinZ = -Infinity;
  let viewMaxZ = Infinity;

  return {
    update(pass: GPUComputePassEncoder) {
      batches.forEach((b, i) => {
        let n = b.capacity;
        if (b.zSorted) {
          const r = sortedRange(
            b.zSorted,
            viewMinZ - GRASS_CULL_MARGIN,
            viewMaxZ + GRASS_CULL_MARGIN,
          );
          if (r.count > 0) b.rangeStart.write(r.first);
          n = r.count;
        } else if (b.live) {
          n = Math.min(b.live.count, b.capacity);
        }
        drawArgs.setInstanceCount(i, n);
        if (n > 0) b.prep.with(pass).dispatchWorkgroups(Math.ceil(n / PREP_WG));
      });
      drawArgs.flush();
    },
    setViewZRange(minZ: number, maxZ: number) {
      viewMinZ = minZ;
      viewMaxZ = maxZ;
    },
    updateMeteor(x: number, y: number, z: number, spin: number) {
      meteorSpec.pos[0] = x;
      meteorSpec.pos[1] = y;
      meteorSpec.pos[2] = z;
      meteorSpec.rotCS[0] = Math.cos(spin);
      meteorSpec.rotCS[1] = Math.sin(spin);
      meteorSpec.scale = y > -50 ? 1.5 : 0;
      writeMeteor(meteorSpecs);
    },
    updateSpikeRocks: writeSpikeRocks,
    updateBoulders: writeBoulders,
    drawShadow(pass: GPURenderPassEncoder) {
      drawAll(pass, true);
    },
    draw(pass: GPURenderPassEncoder) {
      pass.executeBundles([sceneBundle]);
    },
  };
}
