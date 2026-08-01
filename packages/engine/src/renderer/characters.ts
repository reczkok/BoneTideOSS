/**
 * Skinned characters: the player and every enemy type. A compute pass
 * resolves each actor's animation blend into a joint palette, then the
 * scene and shadow passes skin the shared meshes from it with indirect
 * draws sized by the live enemy counts.
 */
import tgpu, { d, std, type TgpuRoot } from 'typegpu';
import { DEBUG_REST_POSE } from '#platform/env.ts';
import { BAKE_FPS } from '../assets/anim.ts';
import type { CharacterAssets, GameAssets } from '../assets/assets.ts';
import { ENEMY_TYPES, MAX_ENEMIES, PLAYER_ANIM } from '../config.ts';
import { CULLED_CLIP, hash11, headingCS, rotateY, yawMatrix } from '../core/gpu.ts';
import { createIndirectArgs } from '../core/indirect.ts';
import { createKernel } from '../core/kernel.ts';
import {
  Actor,
  ACTOR_FLAGS,
  type ActorBuffer,
  JOINTS,
  SkinnedDeformVertex,
  SkinnedShadeVertex,
  STATE,
} from '../core/schemas.ts';
import type { Env } from './env.ts';
import { SHADOW_DEPTH_STENCIL } from './formats.ts';
import { actorStatusShade, StatusFx, statusFxOf } from './materials/status.ts';
import { camera, lightVP, linearSampler } from './scene/bindings.ts';
import { shade } from './scene/lighting.ts';
import { groundHeight } from './scene/terrain.ts';

type ActorView = d.InferGPU<typeof Actor>;

const POSE_WG = 64;
const BLEND_INV = 1 / PLAYER_ANIM.blendDur;
const IDENTITY = d.mat4x4f(
  d.vec4f(1, 0, 0, 0),
  d.vec4f(0, 1, 0, 0),
  d.vec4f(0, 0, 1, 0),
  d.vec4f(0, 0, 0, 1),
);

const drawLayout = tgpu.bindGroupLayout({
  actors: { storage: d.arrayOf(Actor), access: 'readonly' },
  slotBase: { uniform: d.u32 },
  palette: { storage: d.arrayOf(d.mat4x4f), access: 'readonly' },
  paletteBase: { uniform: d.u32 },
  tex: { texture: d.texture2d(d.f32) },
  groundY: { storage: d.arrayOf(d.f32), access: 'readonly' },
});

const poseLayout = tgpu.bindGroupLayout({
  actors: { storage: d.arrayOf(Actor), access: 'readonly' },
  slotBase: { uniform: d.u32 },
  anim: { storage: d.arrayOf(d.mat4x4f), access: 'readonly' },
  poseCount: { uniform: d.u32 },
  paletteBase: { uniform: d.u32 },
  palette: { storage: d.arrayOf(d.mat4x4f), access: 'mutable' },
});

const deformLayout = tgpu.vertexLayout(d.disarrayOf(SkinnedDeformVertex));
const shadeLayout = tgpu.vertexLayout(d.disarrayOf(SkinnedShadeVertex));

const deformIn = {
  position: d.vec3f,
  joints: d.vec4u,
  weights: d.vec4f,
  iid: d.builtin.instanceIndex,
};

/** How far a dying actor has sunk into the ground; > 1.9 means fully gone. */
const sinkOf = (a: ActorView, clipDuration: number) => {
  'use gpu';
  let sink = d.f32(0);
  if (a.state === STATE.DYING) {
    sink = std.max(0, a.animTime - clipDuration - 0.6) * 0.8;
  }
  return sink;
};

const skinMatrixOf = (base: number, joints: d.v4u, weights: d.v4f) => {
  'use gpu';
  const palette = drawLayout.$.palette;
  return (
    palette[base + joints.x] * weights.x +
    palette[base + joints.y] * weights.y +
    palette[base + joints.z] * weights.z +
    palette[base + joints.w] * weights.w
  );
};

const actorWorldPos = (a: ActorView, local: d.v4f, sink: number, groundY: number) => {
  'use gpu';
  const r = rotateY(local.xyz * a.scale, headingCS(a.heading));
  return d.vec3f(a.pos.x + r.x, r.y - sink + groundY, a.pos.y + r.z);
};

const actorWorldDir = (a: ActorView, dir: d.v4f) => {
  'use gpu';
  return rotateY(dir.xyz, headingCS(a.heading));
};

export function createCharacterPass(
  root: TgpuRoot,
  env: Env,
  assets: GameAssets,
  enemyBuf: ActorBuffer,
  playerBuf: ActorBuffer,
) {
  const clipOf = <T>(pick: (c: (typeof assets.clips)[number]) => T) => assets.clips.map(pick);
  const clipOffsets = tgpu.const(
    d.arrayOf(d.u32, assets.clips.length),
    clipOf((c) => c.frameOffset),
  );
  const clipFrames = tgpu.const(
    d.arrayOf(d.u32, assets.clips.length),
    clipOf((c) => c.frameCount),
  );
  const clipLoops = tgpu.const(
    d.arrayOf(d.u32, assets.clips.length),
    clipOf((c) => (c.loop ? 1 : 0)),
  );
  const TINTS = tgpu.const(
    d.arrayOf(d.vec3f, ENEMY_TYPES.length),
    ENEMY_TYPES.map((et) => d.vec3f(...(et.tint ?? [1, 1, 1]))),
  );
  /** Per-joint 0..1 weight of how much the joint follows the legs vs the torso. */
  const TWIST = tgpu.const(d.arrayOf(d.f32, JOINTS), assets.twistFactors);

  const enemyHeightsBuf = root.createBuffer(d.arrayOf(d.f32, MAX_ENEMIES)).$usage('storage');
  const playerHeightsBuf = root.createBuffer(d.arrayOf(d.f32, 1)).$usage('storage');
  const enemyHeights = enemyHeightsBuf.as('mutable');
  const playerHeights = playerHeightsBuf.as('mutable');
  const enemies = enemyBuf.as('readonly');
  const player = playerBuf.as('readonly');
  const heightsKernel = createKernel(env.gpu, [MAX_ENEMIES + 1], (i: number) => {
    'use gpu';
    if (i < MAX_ENEMIES) {
      if (enemies.$[i].state !== STATE.DEAD) {
        enemyHeights.$[i] = groundHeight(enemies.$[i].pos);
      }
    } else {
      playerHeights.$[0] = groundHeight(player.$[0].pos);
    }
  });

  const deathDuration = (a: ActorView) => {
    'use gpu';
    return d.f32(clipFrames.$[a.animClip] - 1) / BAKE_FPS;
  };

  /** (frame A base, frame B base, blend) for a clip at a time, in palette rows. */
  const frameBase = (clip: number, time: number) => {
    'use gpu';
    const frames = clipFrames.$[clip];
    const frameF = time * BAKE_FPS;
    const f0 = d.u32(frameF);
    let i0 = std.min(f0, frames - 1);
    let i1 = std.min(f0 + 1, frames - 1);
    if (clipLoops.$[clip] === 1) {
      i0 = f0 % frames;
      i1 = (f0 + 1) % frames;
    }
    const base = clipOffsets.$[clip] * JOINTS;
    return d.vec3f(d.f32(base + i0 * JOINTS), d.f32(base + i1 * JOINTS), frameF - d.f32(f0));
  };

  const blendedJoint = (j: number, fb: d.v3f) => {
    'use gpu';
    const anim = poseLayout.$.anim;
    return anim[d.u32(fb.x) + j] * (1 - fb.z) + anim[d.u32(fb.y) + j] * fb.z;
  };

  const twistedJoint = (j: number, fb: d.v3f, legYaw: number) => {
    'use gpu';
    return yawMatrix(legYaw * TWIST.$[j]) * blendedJoint(j, fb);
  };

  /** Upper body from `up`, legs from `lo`, mixed per joint by its twist weight. */
  const layeredJoint = (j: number, up: d.v3f, lo: d.v3f, legYaw: number) => {
    'use gpu';
    const w = TWIST.$[j];
    const mixed = blendedJoint(j, up) * (1 - w) + blendedJoint(j, lo) * w;
    return yawMatrix(legYaw * w) * mixed;
  };

  const currentJoint = (a: ActorView, j: number, up: d.v3f, lo: d.v3f) => {
    'use gpu';
    if ((a.flags & ACTOR_FLAGS.LAYERED) !== 0) {
      return layeredJoint(j, up, lo, a.legYaw);
    }
    if (std.abs(a.legYaw) > 0.0001) {
      return twistedJoint(j, up, a.legYaw);
    }
    return blendedJoint(j, up);
  };

  /** Current pose cross-faded with the previous clip while `blendT` runs. */
  const skinJoint = (a: ActorView, j: number, up: d.v3f, lo: d.v3f, prev: d.v3f) => {
    'use gpu';
    let m = currentJoint(a, j, up, lo);
    if (a.blendT > 0) {
      let t = a.blendT * BLEND_INV;
      if ((a.flags & ACTOR_FLAGS.BLEND_UPPER) !== 0) {
        t = t * (1 - TWIST.$[j]);
      }
      m = m * (1 - t) + twistedJoint(j, prev, a.legYaw) * t;
    }
    return m;
  };

  const poseCompute = tgpu.computeFn({
    workgroupSize: [POSE_WG],
    in: { gid: d.builtin.globalInvocationId },
  })((input) => {
    'use gpu';
    const i = input.gid.x;
    if (i >= poseLayout.$.poseCount * JOINTS) {
      return;
    }
    const rel = d.u32(i / JOINTS);
    const j = i - rel * JOINTS;
    const a = poseLayout.$.actors[poseLayout.$.slotBase + rel];
    if (a.state === STATE.DEAD) {
      return;
    }
    const out = (poseLayout.$.paletteBase + rel) * JOINTS + j;
    if (DEBUG_REST_POSE) {
      poseLayout.$.palette[out] = IDENTITY;
      return;
    }
    poseLayout.$.palette[out] = skinJoint(
      a,
      j,
      frameBase(a.animClip, a.animTime),
      frameBase(a.lowerClip, a.lowerTime),
      frameBase(a.prevClip, a.prevTime),
    );
  });
  const posePipeline = env.gpu.createComputePipeline({ compute: poseCompute });

  const skinnedVert = tgpu.vertexFn({
    in: { ...deformIn, normal: d.vec4f, uv: d.vec2f },
    out: {
      position: d.builtin.position,
      wNormal: d.vec3f,
      fragUv: d.vec2f,
      wPos: d.vec3f,
      flash: d.f32,
      tint: d.vec3f,
      seed: d.f32,
      aura: d.vec4f,
      status: d.vec4f,
      freeze: d.f32,
    },
  })((input) => {
    'use gpu';
    const aid = drawLayout.$.slotBase + input.iid;
    const a = drawLayout.$.actors[aid];
    const sink = sinkOf(a, deathDuration(a));
    const seed = hash11(d.f32(aid));
    const fx = statusFxOf(a);
    if (a.state === STATE.DEAD || sink > 1.9) {
      return {
        position: CULLED_CLIP,
        wNormal: d.vec3f(0, 1, 0),
        fragUv: d.vec2f(),
        wPos: d.vec3f(),
        flash: d.f32(0),
        tint: d.vec3f(1),
        seed,
        aura: fx.aura,
        status: fx.status,
        freeze: fx.freeze,
      };
    }
    const skin = skinMatrixOf(
      (drawLayout.$.paletteBase + input.iid) * JOINTS,
      input.joints,
      input.weights,
    );
    let wPos = actorWorldPos(a, skin * d.vec4f(input.position, 1), sink, drawLayout.$.groundY[aid]);
    const shock = fx.status.z;
    if (shock > 0.001) {
      const tw = std.floor(camera.$.time * 28) + seed * 61.7;
      const jitter = d.vec2f(hash11(tw), std.fract(std.sin(tw * 39.425) * 24634.635)) - 0.5;
      wPos += d.vec3f(jitter.x, 0, jitter.y) * (0.11 * shock);
    }
    return {
      position: camera.$.viewProj * d.vec4f(wPos, 1),
      wNormal: actorWorldDir(a, skin * d.vec4f(input.normal.xyz, 0)),
      fragUv: input.uv,
      wPos,
      flash: a.flash,
      tint: TINTS.$[a.typeId],
      seed,
      aura: fx.aura,
      status: fx.status,
      freeze: fx.freeze,
    };
  });

  const skinnedFrag = tgpu.fragmentFn({
    in: {
      wNormal: d.vec3f,
      fragUv: d.vec2f,
      wPos: d.vec3f,
      flash: d.f32,
      tint: d.vec3f,
      seed: d.f32,
      aura: d.vec4f,
      status: d.vec4f,
      freeze: d.f32,
    },
    out: d.vec4f,
  })((input) => {
    'use gpu';
    const albedo = std.textureSample(drawLayout.$.tex, linearSampler.$, input.fragUv).rgb;
    const lit = shade(albedo * input.tint, input.wNormal, input.wPos, input.flash);
    const fx = StatusFx({ aura: input.aura, status: input.status, freeze: input.freeze });
    return d.vec4f(actorStatusShade(lit, albedo, input.wNormal, input.wPos, input.seed, fx), 1);
  });

  const skinnedShadowVert = tgpu.vertexFn({
    in: deformIn,
    out: { position: d.builtin.position },
  })((input) => {
    'use gpu';
    const aid = drawLayout.$.slotBase + input.iid;
    const a = drawLayout.$.actors[aid];
    const sink = sinkOf(a, deathDuration(a));
    if (a.state === STATE.DEAD || sink > 1.9) {
      return { position: CULLED_CLIP };
    }
    const skin = skinMatrixOf(
      (drawLayout.$.paletteBase + input.iid) * JOINTS,
      input.joints,
      input.weights,
    );
    const wPos = actorWorldPos(
      a,
      skin * d.vec4f(input.position, 1),
      sink,
      drawLayout.$.groundY[aid],
    );
    return { position: lightVP.$ * d.vec4f(wPos, 1) };
  });

  const scenePipeline = env.gpu.createRenderPipeline({
    attribs: { ...deformLayout.attrib, ...shadeLayout.attrib },
    vertex: skinnedVert,
    fragment: skinnedFrag,
    targets: { format: env.format },
    primitive: { topology: 'triangle-list', cullMode: 'back' },
    ...env.sceneDepth(true),
  });
  const shadowPipeline = env.gpu.createRenderPipeline({
    attribs: { ...deformLayout.attrib },
    vertex: skinnedShadowVert,
    primitive: { topology: 'triangle-list', cullMode: 'front' },
    depthStencil: SHADOW_DEPTH_STENCIL,
  });

  const paletteBuf = root
    .createBuffer(d.arrayOf(d.mat4x4f, (MAX_ENEMIES + 1) * JOINTS))
    .$usage('storage');

  const makeBatch = (
    ca: CharacterAssets,
    actors: ActorBuffer,
    heights: typeof enemyHeightsBuf,
    firstSlot: number,
    capacity: number,
    paletteBase: number,
  ) => {
    const slotBase = root.createBuffer(d.u32, firstSlot).$usage('uniform');
    const paletteBaseBuf = root.createBuffer(d.u32, paletteBase).$usage('uniform');
    const poseCount = root.createBuffer(d.u32, 0).$usage('uniform');
    const drawBind = root.createBindGroup(drawLayout, {
      actors,
      slotBase,
      palette: paletteBuf,
      paletteBase: paletteBaseBuf,
      tex: ca.texture,
      groundY: heights,
    });
    const poseBind = root.createBindGroup(poseLayout, {
      actors,
      slotBase,
      anim: ca.animBuf,
      poseCount,
      paletteBase: paletteBaseBuf,
      palette: paletteBuf,
    });
    return {
      capacity,
      indexCount: ca.indexCount,
      poseCount,
      lastPoseCount: 0,
      scene: scenePipeline
        .with(deformLayout, ca.deformBuf)
        .with(shadeLayout, ca.shadeBuf)
        .with(drawBind)
        .withIndexBuffer(ca.indexBuf),
      shadow: shadowPipeline
        .with(deformLayout, ca.deformBuf)
        .with(drawBind)
        .withIndexBuffer(ca.indexBuf),
      pose: posePipeline.with(poseBind),
    };
  };

  /** Batch 0 is the player (always one instance); the rest follow ENEMY_TYPES order. */
  const batches = [
    makeBatch(assets.knight, playerBuf, playerHeightsBuf, 0, 1, MAX_ENEMIES),
    ...ENEMY_TYPES.map((et, i) =>
      makeBatch(
        assets.enemies[i],
        enemyBuf,
        enemyHeightsBuf,
        et.slotStart,
        et.slotEnd - et.slotStart,
        et.slotStart,
      ),
    ),
  ];
  const liveCounts = new Int32Array(batches.length).fill(0);
  liveCounts[0] = 1;

  const drawArgs = createIndirectArgs(
    root,
    batches.map((b, i) => ({ indexCount: b.indexCount, instanceCount: liveCounts[i] })),
  );
  const sceneBundle = env.bundle((be) => {
    batches.forEach((b, i) =>
      b.scene.with(be).drawIndexedIndirect(drawArgs.buffer, drawArgs.offsetOf(i)),
    );
  });

  return {
    update(pass: GPUComputePassEncoder) {
      heightsKernel.run(pass);
      batches.forEach((b, i) => {
        const n = liveCounts[i];
        if (n <= 0) return;
        if (n !== b.lastPoseCount) {
          b.poseCount.write(n);
          b.lastPoseCount = n;
        }
        b.pose.with(pass).dispatchWorkgroups(Math.ceil((n * JOINTS) / POSE_WG));
      });
      drawArgs.flush();
    },
    /** Live enemy count per ENEMY_TYPES entry; drives pose dispatch and draw sizes. */
    setLiveCounts(counts: readonly number[]) {
      for (let i = 1; i < batches.length; i++) {
        liveCounts[i] = counts[i - 1] ?? 0;
        drawArgs.setInstanceCount(i, liveCounts[i]);
      }
    },
    resetLiveCounts() {
      for (let i = 1; i < batches.length; i++) {
        liveCounts[i] = 0;
        drawArgs.setInstanceCount(i, 0);
      }
      drawArgs.flush();
    },
    drawShadow(pass: GPURenderPassEncoder) {
      batches.forEach((b, i) =>
        b.shadow.with(pass).drawIndexedIndirect(drawArgs.buffer, drawArgs.offsetOf(i)),
      );
    },
    draw(pass: GPURenderPassEncoder) {
      pass.executeBundles([sceneBundle]);
    },
  };
}
