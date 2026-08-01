/**
 * Spectral weapons: orbiting blades, volley darts and enemy bone arrows as
 * ghostly instanced meshes, each with an additive ribbon trail, plus the
 * player's sword-sweep arc.
 */
import tgpu, { d, std, type TgpuRoot } from 'typegpu';
import { perlin2d } from '@typegpu/noise';
import type { GameAssets, PropAssets } from '../assets/assets.ts';
import { ARROW, BLADES, KEYSTONES, MAX_BLADES, MAX_VOLLEY, PLAYER, SPECTRAL } from '../config.ts';
import {
  CULLED_CLIP,
  fresnel,
  headingCS,
  headingDir,
  luma,
  quadCorner,
  rotateY,
} from '../core/gpu.ts';
import { PropVertex } from '../core/schemas.ts';
import type { Env } from './env.ts';
import { PREMUL_BLEND } from './formats.ts';
import { camera, fx, linearSampler } from './scene/bindings.ts';
import { shade, viewDirTo } from './scene/lighting.ts';

export const SpectralInstance = d.struct({
  pos: d.vec3f,
  yaw: d.f32,
  scale: d.f32,
});
/** CPU record for one instance; `scale <= 0` hides it. */
export type SpectralInstanceSpec = d.InferInput<typeof SpectralInstance>;
type InstanceView = d.InferGPU<typeof SpectralInstance>;

const HIDDEN: SpectralInstanceSpec = { pos: [0, -100, 0], yaw: 0, scale: 0 };

interface Palette {
  ghost: readonly [number, number, number];
  fresnel: readonly [number, number, number];
  lift: readonly [number, number, number];
}

const instLayout = tgpu.bindGroupLayout({
  instances: { storage: d.arrayOf(SpectralInstance), access: 'readonly' },
  tex: { texture: d.texture2d(d.f32) },
});

const vertLayout = tgpu.vertexLayout(d.disarrayOf(PropVertex));

/** Weapon meshes are authored Y-up in a Z-forward frame; swing them into the world frame. */
const meshToWorld = (v: d.v3f) => {
  'use gpu';
  return d.vec3f(v.x, v.z, -v.y);
};

const weaponVert = tgpu.vertexFn({
  in: { position: d.vec3f, normal: d.vec4f, uv: d.vec2f, iid: d.builtin.instanceIndex },
  out: { position: d.builtin.position, wNormal: d.vec3f, fragUv: d.vec2f, wPos: d.vec3f },
})((input) => {
  'use gpu';
  const inst = instLayout.$.instances[input.iid];
  const cs = headingCS(inst.yaw);
  const wPos = inst.pos + rotateY(meshToWorld(input.position * inst.scale), cs);
  return {
    position: camera.$.viewProj * d.vec4f(wPos, 1),
    wNormal: rotateY(meshToWorld(input.normal.xyz), cs),
    fragUv: input.uv,
    wPos,
  };
});

const makeWeaponFrag = (palette: Palette) => {
  const ghostCol = d.vec3f(...palette.ghost);
  const fresCol = d.vec3f(...palette.fresnel);
  const liftCol = d.vec3f(...palette.lift);
  return tgpu.fragmentFn({
    in: { wNormal: d.vec3f, fragUv: d.vec2f, wPos: d.vec3f },
    out: d.vec4f,
  })((input) => {
    'use gpu';
    const albedo = std.textureSample(instLayout.$.tex, linearSampler.$, input.fragUv).rgb;
    const ghost = std.mix(albedo, ghostCol * luma(albedo), 0.6);
    let color = shade(ghost, input.wNormal, input.wPos, d.f32(0));
    const t = camera.$.time;
    const rim = fresnel(std.normalize(input.wNormal), viewDirTo(input.wPos), 2.5);
    const energy = perlin2d.sample(input.fragUv * 6 + d.vec2f(t * 1.7, -t * 2.3)) * 0.5 + 0.5;
    color += fresCol * (rim * (0.7 + 0.7 * energy));
    color += liftCol * (0.7 + 0.3 * std.sin(t * 6));
    return d.vec4f(color, 1);
  });
};

interface RibbonStyle {
  segs: number;
  gain: number;
  color: readonly [number, number, number];
  noiseScale: number;
  noiseSpeed: number;
  pulse: boolean;
  /** World position (xyz) and a noise phase (w) for ribbon fraction `frac`, side `v`. */
  posFn(inst: InstanceView, frac: number, v: number): d.v4f;
  hidden?(inst: InstanceView): boolean;
}

const scaleHidden = (inst: InstanceView) => {
  'use gpu';
  return inst.scale <= 0;
};

/** Trail behind a blade orbiting the player, curving back along its orbit. */
const bladeArcPos = (inst: InstanceView, frac: number, v: number) => {
  'use gpu';
  const center = fx.$.playerPos;
  const rel = inst.pos.xz - center;
  const radius = std.max(std.length(rel), 1e-3);
  const a = std.atan2(rel.x, rel.y) - frac * BLADES.trailArc;
  const halfW = BLADES.trailWidth * (1 - frac * 0.85);
  const rad = radius + (v * 2 - 1) * halfW;
  return d.vec4f(
    center.x + std.sin(a) * rad,
    inst.pos.y - frac * 0.18,
    center.y + std.cos(a) * rad,
    a,
  );
};

/** Straight wake behind a flying projectile, `widthMul`/`lenMul` stretch it. */
const wakePos = (inst: InstanceView, frac: number, v: number, widthMul: number, lenMul: number) => {
  'use gpu';
  const dir = headingDir(inst.yaw);
  const side = d.vec2f(dir.y, -dir.x);
  const nose = std.smoothstep(0, SPECTRAL.arrowTrailNose, frac);
  const halfW = SPECTRAL.arrowTrailHalfWidth * widthMul * nose * (1 - frac);
  const back = SPECTRAL.arrowTrailBack + frac * SPECTRAL.arrowTrailLen * lenMul;
  const offset = side * ((v * 2 - 1) * halfW) - dir * back;
  return d.vec4f(inst.pos.x + offset.x, inst.pos.y - frac * 0.08, inst.pos.z + offset.y, frac);
};

const boneWakePos = (inst: InstanceView, frac: number, v: number) => {
  'use gpu';
  return wakePos(inst, frac, v, d.f32(1), d.f32(1));
};

/** The player's sword arc (or stab) sampled along the current swing. */
const swordSweepPos = (_inst: InstanceView, frac: number, v: number) => {
  'use gpu';
  const f = fx.$;
  const sweep = std.clamp(
    (camera.$.time - f.swingStart - PLAYER.sparkStart) / (PLAYER.sparkEnd - PLAYER.sparkStart),
    0,
    1,
  );
  if (std.abs(f.swingSign) < 0.5) {
    const dirN = std.normalize(f.swingDir);
    const ext = 1 - (1 - sweep) * (1 - sweep);
    const tip = 0.5 + ext * PLAYER.stabReach;
    const along = std.max(tip - frac * PLAYER.stabLen, 0.2);
    const nose = std.smoothstep(0, 0.3, frac);
    const off = (v * 2 - 1) * (PLAYER.stabWidth * nose * (1 - frac * 0.7));
    return d.vec4f(
      f.playerPos.x + dirN.x * along + dirN.y * off,
      PLAYER.sparkHeight - frac * 0.12,
      f.playerPos.y + dirN.y * along - dirN.x * off,
      along,
    );
  }
  const base = std.atan2(f.swingDir.x, f.swingDir.y);
  const half = f.swingArc * 0.5;
  const lead = -half + sweep * f.swingArc;
  const u = std.max(lead - frac * PLAYER.trailArc, -half);
  const a = base + f.swingSign * u;
  const halfW = PLAYER.trailWidth * (1 - frac * 0.8);
  const rad = PLAYER.sparkRadius + (v * 2 - 1) * halfW;
  return d.vec4f(
    f.playerPos.x + std.sin(a) * rad,
    PLAYER.sparkHeight - frac * 0.12,
    f.playerPos.y + std.cos(a) * rad,
    a,
  );
};

const swordHidden = (_inst: InstanceView) => {
  'use gpu';
  return fx.$.swingStart < 0;
};

export function createSpectralPass(root: TgpuRoot, env: Env, assets: GameAssets) {
  const weaponTex = assets.enemies[0].texture;

  const makeWeaponPipeline = (palette: Palette) =>
    env.gpu.createRenderPipeline({
      attribs: { ...vertLayout.attrib },
      vertex: weaponVert,
      fragment: makeWeaponFrag(palette),
      targets: { format: env.format },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      ...env.sceneDepth(true),
    });

  const makeRibbon = (style: RibbonStyle, bindGroup: ReturnType<typeof makeBatch>['bindGroup']) => {
    const { segs, gain, noiseScale, noiseSpeed, pulse, posFn } = style;
    const hidden = style.hidden ?? scaleHidden;
    const verts = segs * 6;
    const color = d.vec3f(...style.color);

    const vert = tgpu.vertexFn({
      in: { vid: d.builtin.vertexIndex },
      out: { position: d.builtin.position, frac: d.f32, side: d.f32, noise: d.f32 },
    })((input) => {
      'use gpu';
      const k = d.u32(input.vid / verts);
      const r = input.vid - k * verts;
      const s = d.u32(r / 6);
      const corner = quadCorner(r);
      const u = corner.x * 0.5 + 0.5;
      const v = corner.y * 0.5 + 0.5;
      const inst = instLayout.$.instances[k];
      const frac = (d.f32(s) + u) / segs;
      const pw = posFn(inst, frac, v);
      let clip = camera.$.viewProj * d.vec4f(pw.xyz, 1);
      if (hidden(inst)) {
        clip = CULLED_CLIP;
      }
      return { position: clip, frac, side: v, noise: pw.w };
    });

    const frag = tgpu.fragmentFn({
      in: { frac: d.f32, side: d.f32, noise: d.f32 },
      out: d.vec4f,
    })((input) => {
      'use gpu';
      const t = camera.$.time;
      const fade = (1 - input.frac) * (1 - input.frac);
      const across = std.smoothstep(0, 1, 1 - std.abs(input.side * 2 - 1));
      const flicker =
        0.75 + 0.35 * perlin2d.sample(d.vec2f(input.noise * noiseScale, t * noiseSpeed));
      let strength = fade * across * flicker * std.smoothstep(0, 0.22, input.frac);
      if (pulse) {
        strength *= 0.85 + 0.25 * std.sin(t * 6);
      }
      return d.vec4f(color * (strength * gain), 0);
    });

    const chain = env.gpu
      .createRenderPipeline({
        vertex: vert,
        fragment: frag,
        targets: { format: env.format, blend: PREMUL_BLEND },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        ...env.sceneDepth(false),
      })
      .with(bindGroup);
    return (pass: GPURenderPassEncoder, instances: number) => {
      chain.with(pass).draw(instances * verts);
    };
  };

  const makeBatch = (
    pipeline: ReturnType<typeof makeWeaponPipeline>,
    mesh: PropAssets,
    capacity: number,
  ) => {
    const instBuf = root.createBuffer(d.arrayOf(SpectralInstance, capacity)).$usage('storage');
    const bindGroup = root.createBindGroup(instLayout, { instances: instBuf, tex: weaponTex });
    const chain = pipeline
      .with(vertLayout, mesh.vertexBuf)
      .with(bindGroup)
      .withIndexBuffer(mesh.indexBuf);
    const padded: SpectralInstanceSpec[] = Array.from({ length: capacity }, () => HIDDEN);
    let liveCount = 0;
    return {
      bindGroup,
      get liveCount() {
        return liveCount;
      },
      /** Uploads up to `capacity` instances; shorter lists are padded with hidden slots. */
      write(instances: readonly SpectralInstanceSpec[]) {
        let hi = 0;
        for (let i = 0; i < capacity; i++) {
          const src = instances[i];
          const visible = src !== undefined && src.scale > 0;
          padded[i] = visible ? src : HIDDEN;
          if (visible) hi = i + 1;
        }
        if (hi > 0 || liveCount > 0) instBuf.write(padded);
        liveCount = hi;
      },
      draw(pass: GPURenderPassEncoder) {
        chain.with(pass).drawIndexed(mesh.indexCount, liveCount);
      },
    };
  };

  const blades = makeBatch(
    makeWeaponPipeline(SPECTRAL.bladePalette),
    assets.spectral.blade,
    MAX_BLADES,
  );
  const darts = makeBatch(
    makeWeaponPipeline(SPECTRAL.dartPalette),
    assets.spectral.arrow,
    MAX_VOLLEY,
  );
  const boneArrows = makeBatch(
    makeWeaponPipeline(SPECTRAL.boneArrowPalette),
    assets.spectral.arrow,
    ARROW.maxInFlight,
  );

  const wakeStyle = root.createUniform(d.vec2f, [1, 1]);
  const dartWakePos = (inst: InstanceView, frac: number, v: number) => {
    'use gpu';
    return wakePos(inst, frac, v, wakeStyle.$.x, wakeStyle.$.y);
  };

  const trailStyle = { noiseScale: 2.8, noiseSpeed: 2.6, pulse: false, segs: 6 };
  const drawBladeTrail = makeRibbon(
    {
      segs: 14,
      gain: SPECTRAL.bladeTrailGain,
      color: SPECTRAL.trailColor,
      noiseScale: 2.2,
      noiseSpeed: 3.1,
      pulse: true,
      posFn: bladeArcPos,
    },
    blades.bindGroup,
  );
  const drawDartTrail = makeRibbon(
    {
      ...trailStyle,
      gain: SPECTRAL.arrowTrailGain,
      color: SPECTRAL.dartTrailColor,
      posFn: dartWakePos,
    },
    darts.bindGroup,
  );
  const drawBoneTrail = makeRibbon(
    {
      ...trailStyle,
      gain: SPECTRAL.boneTrailGain,
      color: SPECTRAL.boneTrailColor,
      posFn: boneWakePos,
    },
    boneArrows.bindGroup,
  );

  const swordInstBuf = root
    .createBuffer(d.arrayOf(SpectralInstance, 1), [{ pos: [0, 0, 0], yaw: 0, scale: 1 }])
    .$usage('storage');
  const drawSwordTrail = makeRibbon(
    {
      segs: 10,
      gain: PLAYER.trailGain,
      color: PLAYER.trailColor,
      noiseScale: 2.6,
      noiseSpeed: 3.4,
      pulse: false,
      posFn: swordSweepPos,
      hidden: swordHidden,
    },
    root.createBindGroup(instLayout, { instances: swordInstBuf, tex: weaponTex }),
  );

  const drawWithTrail = (
    pass: GPURenderPassEncoder,
    batch: ReturnType<typeof makeBatch>,
    trail: ReturnType<typeof makeRibbon>,
  ) => {
    if (batch.liveCount === 0) return;
    batch.draw(pass);
    trail(pass, batch.liveCount);
  };

  return {
    update(bladeInst: readonly SpectralInstanceSpec[], dartInst: readonly SpectralInstanceSpec[]) {
      blades.write(bladeInst);
      darts.write(dartInst);
    },
    updateEnemyArrows: boneArrows.write,
    setToxicWake(on: boolean) {
      const tw = KEYSTONES.toxicWake;
      wakeStyle.write(on ? [tw.ribbonWidthMul, tw.ribbonLenMul] : [1, 1]);
    },
    draw(pass: GPURenderPassEncoder) {
      drawWithTrail(pass, blades, drawBladeTrail);
      drawWithTrail(pass, darts, drawDartTrail);
      drawWithTrail(pass, boneArrows, drawBoneTrail);
      drawSwordTrail(pass, 1);
    },
  };
}
