import type { SampledFlag, TgpuRoot, TgpuTexture } from 'typegpu';
import { mat4 } from 'wgpu-matrix';
import { BAKE_FPS, type BakedClipMeta } from './anim.ts';
import { CLIP, CLIP_SOURCES, type ClipSource } from '../core/animation.ts';
import { JOINTS } from '../core/schemas.ts';
import type { MeshData } from './gltf.ts';

const CELLS = 4;
const CELL_PX = 32;
const TEX_PX = CELLS * CELL_PX;

export const PALETTE = {
  bone: 0,
  cloth: 1,
  metal: 2,
  leather: 3,
  bark: 4,
  leaf: 5,
  stone: 6,
  grass: 7,
  moss: 8,
  ember: 9,
  shadow: 10,
  pale: 11,
  rust: 12,
  slate: 13,
  sand: 14,
  ink: 15,
} as const;

export type PaletteSlot = (typeof PALETTE)[keyof typeof PALETTE];

const PALETTE_RGB: Record<number, [number, number, number]> = {
  0: [214, 205, 184],
  1: [92, 84, 110],
  2: [150, 156, 168],
  3: [110, 78, 54],
  4: [86, 64, 44],
  5: [78, 112, 62],
  6: [124, 124, 122],
  7: [104, 138, 74],
  8: [70, 96, 58],
  9: [196, 110, 52],
  10: [52, 50, 58],
  11: [186, 190, 196],
  12: [140, 88, 56],
  13: [96, 102, 110],
  14: [178, 160, 122],
  15: [34, 32, 38],
};

const cellUv = (slot: number): [number, number] => {
  const cx = slot % CELLS;
  const cy = Math.floor(slot / CELLS) % CELLS;
  return [(cx + 0.5) / CELLS, (cy + 0.5) / CELLS];
};

interface Part {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
  joints: number[];
  weights: number[];
}

const emptyPart = (): Part => ({
  positions: [],
  normals: [],
  uvs: [],
  indices: [],
  joints: [],
  weights: [],
});

function pushVertex(
  part: Part,
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  slot: number,
  joint: number,
) {
  const [u, v] = cellUv(slot);
  part.positions.push(x, y, z);
  part.normals.push(nx, ny, nz);
  part.uvs.push(u, v);
  part.joints.push(joint, 0, 0, 0);
  part.weights.push(1, 0, 0, 0);
}

function pushQuad(
  part: Part,
  corners: [number, number, number][],
  normal: [number, number, number],
  slot: number,
  joint: number,
) {
  const base = part.positions.length / 3;
  for (const [x, y, z] of corners) {
    pushVertex(part, x, y, z, normal[0], normal[1], normal[2], slot, joint);
  }
  part.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function box(
  part: Part,
  min: [number, number, number],
  max: [number, number, number],
  slot: number,
  joint: number,
) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  pushQuad(
    part,
    [
      [x0, y0, z1],
      [x1, y0, z1],
      [x1, y1, z1],
      [x0, y1, z1],
    ],
    [0, 0, 1],
    slot,
    joint,
  );
  pushQuad(
    part,
    [
      [x1, y0, z0],
      [x0, y0, z0],
      [x0, y1, z0],
      [x1, y1, z0],
    ],
    [0, 0, -1],
    slot,
    joint,
  );
  pushQuad(
    part,
    [
      [x1, y0, z1],
      [x1, y0, z0],
      [x1, y1, z0],
      [x1, y1, z1],
    ],
    [1, 0, 0],
    slot,
    joint,
  );
  pushQuad(
    part,
    [
      [x0, y0, z0],
      [x0, y0, z1],
      [x0, y1, z1],
      [x0, y1, z0],
    ],
    [-1, 0, 0],
    slot,
    joint,
  );
  pushQuad(
    part,
    [
      [x0, y1, z1],
      [x1, y1, z1],
      [x1, y1, z0],
      [x0, y1, z0],
    ],
    [0, 1, 0],
    slot,
    joint,
  );
  pushQuad(
    part,
    [
      [x0, y0, z0],
      [x1, y0, z0],
      [x1, y0, z1],
      [x0, y0, z1],
    ],
    [0, -1, 0],
    slot,
    joint,
  );
}

function tube(
  part: Part,
  y0: number,
  y1: number,
  r0: number,
  r1: number,
  segments: number,
  slot: number,
  joint: number,
) {
  const base = part.positions.length / 3;
  const slope = (r0 - r1) / Math.max(y1 - y0, 1e-4);
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const cx = Math.cos(a);
    const cz = Math.sin(a);
    const ny = slope / Math.hypot(1, slope);
    const nr = 1 / Math.hypot(1, slope);
    pushVertex(part, cx * r0, y0, cz * r0, cx * nr, ny, cz * nr, slot, joint);
    pushVertex(part, cx * r1, y1, cz * r1, cx * nr, ny, cz * nr, slot, joint);
  }
  for (let i = 0; i < segments; i++) {
    const a = base + i * 2;
    part.indices.push(a, a + 3, a + 2, a, a + 1, a + 3);
  }
  if (r1 > 1e-4) {
    const capBase = part.positions.length / 3;
    pushVertex(part, 0, y1, 0, 0, 1, 0, slot, joint);
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pushVertex(part, Math.cos(a) * r1, y1, Math.sin(a) * r1, 0, 1, 0, slot, joint);
    }
    for (let i = 0; i < segments; i++) {
      part.indices.push(capBase, capBase + 2 + i, capBase + 1 + i);
    }
  }
}

function blob(
  part: Part,
  cy: number,
  radius: number,
  squash: number,
  segments: number,
  rings: number,
  slot: number,
  seed: number,
) {
  const base = part.positions.length / 3;
  const wobble = (i: number, j: number) =>
    0.86 + 0.28 * Math.abs(Math.sin(seed * 12.9898 + i * 4.1 + j * 7.3));
  for (let j = 0; j <= rings; j++) {
    const phi = (j / rings) * Math.PI;
    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      const w = wobble(i % segments, j);
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.cos(phi);
      const nz = Math.sin(phi) * Math.sin(theta);
      pushVertex(
        part,
        nx * radius * w,
        cy + ny * radius * squash * w,
        nz * radius * w,
        nx,
        ny,
        nz,
        slot,
        0,
      );
    }
  }
  const stride = segments + 1;
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < segments; i++) {
      const a = base + j * stride + i;
      part.indices.push(a, a + stride + 1, a + stride, a, a + 1, a + stride + 1);
    }
  }
}

function blade(part: Part, angle: number, width: number, height: number, slot: number) {
  const c = Math.cos(angle) * width * 0.5;
  const s = Math.sin(angle) * width * 0.5;
  // One quad per blade: the prop pipeline draws with cullMode 'none' and the
  // fragment shader flips the normal on back faces. A second coincident quad
  // would only z-fight with this one.
  pushQuad(
    part,
    [
      [c, 0, s],
      [-c, 0, -s],
      [-c, height, -s],
      [c, height, s],
    ],
    [-Math.sin(angle), 0.4, Math.cos(angle)],
    slot,
    0,
  );
}

const toMesh = (part: Part, skinned: boolean): MeshData => ({
  positions: new Float32Array(part.positions),
  normals: new Float32Array(part.normals),
  uvs: new Float32Array(part.uvs),
  indices: new Uint32Array(part.indices),
  ...(skinned
    ? { joints: new Uint32Array(part.joints), weights: new Float32Array(part.weights) }
    : {}),
});

const J_ROOT = 0;
const J_HEAD = 1;
const J_ARM_L = 2;
const J_ARM_R = 3;
const J_LEG_L = 4;
const J_LEG_R = 5;

const HIP_Y = 0.86;
const SHOULDER_Y = 1.45;

export interface PlaceholderFigure {
  body: PaletteSlot;
  trim: PaletteSlot;
  height: number;
  bulk: number;
}

export const FIGURES = {
  knight: { body: PALETTE.metal, trim: PALETTE.cloth, height: 1.0, bulk: 1.0 },
  skeleton: { body: PALETTE.bone, trim: PALETTE.leather, height: 0.98, bulk: 0.82 },
  brute: { body: PALETTE.bone, trim: PALETTE.rust, height: 1.12, bulk: 1.3 },
  caster: { body: PALETTE.bone, trim: PALETTE.ink, height: 1.0, bulk: 0.9 },
} as const satisfies Record<string, PlaceholderFigure>;

export function placeholderFigureFor(model: string): PlaceholderFigure {
  const name = model.toLowerCase();
  if (name.includes('knight')) return FIGURES.knight;
  if (name.includes('golem') || name.includes('warrior')) return FIGURES.brute;
  if (name.includes('mage') || name.includes('necromancer')) return FIGURES.caster;
  return FIGURES.skeleton;
}

export function placeholderCharacterMesh(figure: PlaceholderFigure): MeshData {
  const part = emptyPart();
  const h = figure.height;
  const w = 0.17 * figure.bulk;
  box(part, [-w, HIP_Y * h, -0.11], [w, SHOULDER_Y * h, 0.11], figure.body, J_ROOT);
  box(
    part,
    [-0.13 * figure.bulk, SHOULDER_Y * h, -0.12],
    [0.13 * figure.bulk, (SHOULDER_Y + 0.28) * h, 0.12],
    figure.body,
    J_HEAD,
  );
  box(
    part,
    [w, (SHOULDER_Y - 0.55) * h, -0.06],
    [w + 0.11, SHOULDER_Y * h, 0.06],
    figure.trim,
    J_ARM_L,
  );
  box(
    part,
    [-w - 0.11, (SHOULDER_Y - 0.55) * h, -0.06],
    [-w, SHOULDER_Y * h, 0.06],
    figure.trim,
    J_ARM_R,
  );
  box(part, [0.02, 0, -0.07], [0.02 + 0.12, HIP_Y * h, 0.07], figure.body, J_LEG_L);
  box(part, [-0.02 - 0.12, 0, -0.07], [-0.02, HIP_Y * h, 0.07], figure.body, J_LEG_R);
  return toMesh(part, true);
}

export function placeholderWeaponMesh(kind: string): MeshData {
  const part = emptyPart();
  const name = kind.toLowerCase();
  if (name.includes('arrow') || name.includes('bolt')) {
    box(part, [-0.014, -0.34, -0.014], [0.014, 0.34, 0.014], PALETTE.bark, 0);
    box(part, [-0.03, 0.34, -0.005], [0.03, 0.46, 0.005], PALETTE.metal, 0);
  } else if (name.includes('shield')) {
    box(part, [-0.22, -0.26, -0.03], [0.22, 0.26, 0.03], PALETTE.rust, 0);
  } else if (name.includes('staff') || name.includes('wand')) {
    box(part, [-0.025, -0.55, -0.025], [0.025, 0.62, 0.025], PALETTE.bark, 0);
    blob(part, 0.7, 0.09, 1, 8, 6, PALETTE.ember, 3);
  } else {
    box(part, [-0.035, -0.12, -0.02], [0.035, 0.06, 0.02], PALETTE.leather, 0);
    box(part, [-0.12, 0.06, -0.02], [0.12, 0.11, 0.02], PALETTE.metal, 0);
    box(part, [-0.05, 0.11, -0.014], [0.05, 0.86, 0.014], PALETTE.metal, 0);
  }
  return toMesh(part, false);
}

export function placeholderPropMesh(name: string): MeshData {
  const part = emptyPart();
  const seed = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  const jitter = 0.85 + ((seed % 7) / 7) * 0.4;
  if (name.startsWith('Tree_Bare')) {
    tube(part, 0, 3.4 * jitter, 0.24, 0.09, 7, PALETTE.bark, 0);
    tube(part, 2.0 * jitter, 3.1 * jitter, 0.1, 0.03, 5, PALETTE.bark, 0);
  } else if (name.startsWith('Tree')) {
    tube(part, 0, 2.1 * jitter, 0.26, 0.16, 7, PALETTE.bark, 0);
    blob(part, 3.1 * jitter, 1.25 * jitter, 1.15, 10, 7, PALETTE.leaf, seed);
    blob(part, 4.0 * jitter, 0.8 * jitter, 1.0, 8, 6, PALETTE.leaf, seed + 3);
  } else if (name.startsWith('Rock')) {
    blob(part, 0.34 * jitter, 0.62 * jitter, 0.72, 9, 6, PALETTE.stone, seed);
  } else if (name.startsWith('Bush')) {
    blob(part, 0.42 * jitter, 0.52 * jitter, 0.86, 9, 6, PALETTE.moss, seed);
  } else {
    const height = 0.42 * jitter;
    blade(part, 0, 0.3, height, PALETTE.grass);
    blade(part, Math.PI / 3, 0.28, height * 0.85, PALETTE.grass);
    blade(part, (Math.PI * 2) / 3, 0.26, height * 0.7, PALETTE.grass);
  }
  return toMesh(part, false);
}

export function placeholderTexture(root: TgpuRoot): TgpuTexture & SampledFlag {
  const data = new Uint8Array(TEX_PX * TEX_PX * 4);
  for (let y = 0; y < TEX_PX; y++) {
    for (let x = 0; x < TEX_PX; x++) {
      const slot = Math.floor(y / CELL_PX) * CELLS + Math.floor(x / CELL_PX);
      const rgb = PALETTE_RGB[slot] ?? [255, 0, 255];
      const grain = ((x * 7 + y * 13) % 11) - 5;
      const i = (y * TEX_PX + x) * 4;
      data[i] = Math.max(0, Math.min(255, rgb[0] + grain));
      data[i + 1] = Math.max(0, Math.min(255, rgb[1] + grain));
      data[i + 2] = Math.max(0, Math.min(255, rgb[2] + grain));
      data[i + 3] = 255;
    }
  }
  const tex = root
    .createTexture({ size: [TEX_PX, TEX_PX], format: 'rgba8unorm', mipLevelCount: 4 })
    .$usage('sampled', 'render');
  tex.write(data);
  tex.generateMipmaps();
  return tex;
}

type PoseKind = 'idle' | 'walk' | 'run' | 'death' | 'hit' | 'spawn' | 'swing' | 'cast' | 'dodge';

interface ClipShape {
  kind: PoseKind;
  duration: number;
}

const SHAPES: Record<number, ClipShape> = {
  [CLIP.IDLE]: { kind: 'idle', duration: 2.4 },
  [CLIP.WALK]: { kind: 'walk', duration: 1.0 },
  [CLIP.RUN]: { kind: 'run', duration: 0.62 },
  [CLIP.DEATH]: { kind: 'death', duration: 1.15 },
  [CLIP.HIT]: { kind: 'hit', duration: 0.36 },
  [CLIP.SPAWN]: { kind: 'spawn', duration: 1.2 },
  [CLIP.ECAST]: { kind: 'cast', duration: 1.0 },
  [CLIP.ERAISE]: { kind: 'cast', duration: 1.1 },
  [CLIP.CAST]: { kind: 'cast', duration: 1.0 },
  [CLIP.RAISE]: { kind: 'cast', duration: 1.1 },
  [CLIP.DODGE_F]: { kind: 'dodge', duration: 0.5 },
  [CLIP.DODGE_B]: { kind: 'dodge', duration: 0.5 },
  [CLIP.DODGE_L]: { kind: 'dodge', duration: 0.5 },
  [CLIP.DODGE_R]: { kind: 'dodge', duration: 0.5 },
};

const shapeFor = (index: number): ClipShape => SHAPES[index] ?? { kind: 'swing', duration: 0.72 };

const IDENTITY = mat4.identity(new Float32Array(16));

function pivotRotX(pivotY: number, angle: number, out: Float32Array) {
  mat4.translation([0, pivotY, 0], out);
  mat4.rotateX(out, angle, out);
  mat4.translate(out, [0, -pivotY, 0], out);
  return out;
}

function writePose(target: Float32Array, offset: number, kind: PoseKind, phase: number) {
  const root = mat4.identity(new Float32Array(16));
  const local: Float32Array[] = [];
  for (let j = 0; j < 6; j++) local.push(mat4.identity(new Float32Array(16)));
  const wave = Math.sin(phase * Math.PI * 2);
  const wave2 = Math.sin(phase * Math.PI * 4);
  const once = Math.sin(Math.min(1, phase) * Math.PI);

  if (kind === 'idle') {
    mat4.translation([0, 0.012 * wave, 0], root);
    pivotRotX(SHOULDER_Y, 0.06 * wave, local[J_ARM_L]);
    pivotRotX(SHOULDER_Y, -0.06 * wave, local[J_ARM_R]);
    pivotRotX(SHOULDER_Y + 0.2, 0.03 * wave, local[J_HEAD]);
  } else if (kind === 'walk' || kind === 'run') {
    const gain = kind === 'run' ? 0.95 : 0.52;
    mat4.translation([0, Math.abs(wave2) * (kind === 'run' ? 0.07 : 0.03), 0], root);
    pivotRotX(HIP_Y, wave * gain, local[J_LEG_L]);
    pivotRotX(HIP_Y, -wave * gain, local[J_LEG_R]);
    pivotRotX(SHOULDER_Y, -wave * gain * 0.7, local[J_ARM_L]);
    pivotRotX(SHOULDER_Y, wave * gain * 0.7, local[J_ARM_R]);
  } else if (kind === 'death') {
    const fall = Math.min(1, phase * 1.15) ** 2;
    mat4.translation([0, -0.1 * fall, 0.35 * fall], root);
    mat4.rotateX(root, -fall * Math.PI * 0.48, root);
  } else if (kind === 'hit') {
    pivotRotX(HIP_Y, -once * 0.3, root);
  } else if (kind === 'spawn') {
    const t = Math.min(1, phase * 1.05);
    mat4.translation([0, (t * t - 1) * 1.7, 0], root);
  } else if (kind === 'cast') {
    pivotRotX(SHOULDER_Y, -once * 2.1, local[J_ARM_L]);
    pivotRotX(SHOULDER_Y, -once * 2.1, local[J_ARM_R]);
    pivotRotX(HIP_Y, -once * 0.12, root);
  } else if (kind === 'dodge') {
    mat4.translation([0, once * 0.22, 0], root);
    mat4.rotateX(root, once * 0.24, root);
    pivotRotX(HIP_Y, once * 0.5, local[J_LEG_L]);
    pivotRotX(HIP_Y, -once * 0.5, local[J_LEG_R]);
  } else {
    const wind = Math.sin(Math.min(1, phase) * Math.PI * 0.5);
    pivotRotX(SHOULDER_Y, 2.3 * wind - once * 3.0, local[J_ARM_R]);
    pivotRotX(SHOULDER_Y, once * 0.35, local[J_ARM_L]);
    pivotRotX(HIP_Y, once * 0.18, root);
  }

  const world = new Float32Array(16);
  for (let j = 0; j < JOINTS; j++) {
    if (j >= local.length) {
      target.set(IDENTITY, offset + j * 16);
    } else if (j === J_ROOT) {
      target.set(root, offset + j * 16);
    } else {
      mat4.multiply(root, local[j], world);
      target.set(world, offset + j * 16);
    }
  }
}

export interface PlaceholderBake {
  data: Float32Array;
  clips: BakedClipMeta[];
}

export function placeholderBake(sources: readonly ClipSource[] = CLIP_SOURCES): PlaceholderBake {
  const clips: BakedClipMeta[] = [];
  let frames = 0;
  const plan = sources.map((source, index) => {
    const shape = shapeFor(index);
    const frameCount = Math.max(2, Math.round(shape.duration * BAKE_FPS));
    const meta: BakedClipMeta = {
      name: source.name,
      frameOffset: frames,
      frameCount,
      duration: frameCount / BAKE_FPS,
      loop: source.loop,
    };
    if (index === CLIP.RUN) meta.plantPhases = [0.25, 0.75];
    clips.push(meta);
    frames += frameCount;
    return { shape, meta };
  });

  const data = new Float32Array(frames * JOINTS * 16);
  for (const { shape, meta } of plan) {
    for (let f = 0; f < meta.frameCount; f++) {
      const phase = meta.loop ? f / meta.frameCount : f / Math.max(1, meta.frameCount - 1);
      writePose(data, (meta.frameOffset + f) * JOINTS * 16, shape.kind, phase);
    }
  }
  return { data, clips };
}

export const PLACEHOLDER_TWISTS: number[] = Array.from({ length: JOINTS }, (_, j) =>
  j === J_LEG_L || j === J_LEG_R ? 1 : 0,
);
