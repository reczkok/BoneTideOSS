import { mat4, quat, vec3 } from 'wgpu-matrix';
import type { ClipSource } from '../core/animation.ts';
import { concat } from './gltf.ts';
import type { AnimClip, CharacterData, SkeletonNode } from './gltf.ts';

export const BAKE_FPS = 30;

export interface BakedClipMeta {
  name: string;
  frameOffset: number;
  frameCount: number;
  duration: number;
  loop: boolean;
  plantPhases?: readonly number[];
}

interface BakedAnimations {
  data: Float32Array;
  clips: BakedClipMeta[];
  jointCount: number;
}

type ChannelIndex = Map<string, Map<string, { times: Float32Array; values: Float32Array }>>;

function indexChannels(clip: AnimClip): ChannelIndex {
  const byNode: ChannelIndex = new Map();
  for (const ch of clip.channels) {
    let m = byNode.get(ch.nodeName);
    if (!m) byNode.set(ch.nodeName, (m = new Map()));
    m.set(ch.path, { times: ch.times, values: ch.values });
  }
  return byNode;
}

function sampleChannel(
  times: Float32Array,
  values: Float32Array,
  comps: number,
  t: number,
  out: Float32Array,
  slerp: boolean,
) {
  let i1 = 0;
  while (i1 < times.length && times[i1] < t) i1++;
  if (i1 === 0) {
    out.set(values.subarray(0, comps));
    return;
  }
  if (i1 >= times.length) {
    out.set(values.subarray((times.length - 1) * comps, times.length * comps));
    return;
  }
  const i0 = i1 - 1;
  const span = times[i1] - times[i0];
  const f = span > 1e-6 ? (t - times[i0]) / span : 0;
  const a = values.subarray(i0 * comps, i0 * comps + comps);
  const b = values.subarray(i1 * comps, i1 * comps + comps);
  if (slerp) {
    quat.slerp(a, b, f, out);
  } else {
    for (let c = 0; c < comps; c++) out[c] = a[c] + (b[c] - a[c]) * f;
  }
}

const tmpTranslation = new Float32Array(3);
const tmpRotation = new Float32Array(4);
const tmpScale = new Float32Array(3);
const tmpLocal = new Float32Array(16);

function clipLocalOf(
  nodes: SkeletonNode[],
  channels: ChannelIndex,
  t: number,
  boneScale?: Map<string, number>,
): (i: number, out: Float32Array) => void {
  return (i, out) => {
    const nd = nodes[i];
    tmpTranslation.set(nd.t);
    tmpRotation.set(nd.r);
    tmpScale.set(nd.s);
    const anim = channels.get(nd.name);
    if (anim) {
      const tr = anim.get('translation');
      if (tr) {
        sampleChannel(tr.times, tr.values, 3, t, tmpTranslation, false);
        const bs = boneScale?.get(nd.name);
        if (bs !== undefined) {
          tmpTranslation[0] *= bs;
          tmpTranslation[1] *= bs;
          tmpTranslation[2] *= bs;
        }
      }
      const ro = anim.get('rotation');
      if (ro) sampleChannel(ro.times, ro.values, 4, t, tmpRotation, true);
      const sc = anim.get('scale');
      if (sc) sampleChannel(sc.times, sc.values, 3, t, tmpScale, false);
    }
    composeTRS(tmpTranslation, tmpRotation, tmpScale, out);
  };
}

function composeTRS(t: Float32Array, r: Float32Array, s: Float32Array, out: Float32Array) {
  mat4.fromQuat(r, out);
  for (let c = 0; c < 3; c++) {
    out[c * 4] *= s[c];
    out[c * 4 + 1] *= s[c];
    out[c * 4 + 2] *= s[c];
  }
  out[12] = t[0];
  out[13] = t[1];
  out[14] = t[2];
}

function computeGlobals(
  nodes: SkeletonNode[],
  localOf: (i: number, out: Float32Array) => void,
): Float32Array {
  const n = nodes.length;
  const globals = new Float32Array(n * 16);
  const done = new Uint8Array(n);

  const resolve = (i: number): Float32Array => {
    const g = globals.subarray(i * 16, i * 16 + 16);
    if (done[i]) return g;
    done[i] = 1;
    localOf(i, tmpLocal);
    const p = nodes[i].parent;
    if (p < 0) {
      g.set(tmpLocal);
    } else {
      const local = tmpLocal.slice();
      mat4.multiply(resolve(p), local, g);
    }
    return g;
  };

  for (let i = 0; i < n; i++) resolve(i);
  return globals;
}

function restGlobals(character: CharacterData): Float32Array {
  return computeGlobals(character.nodes, (i, out) => {
    const nd = character.nodes[i];
    tmpTranslation.set(nd.t);
    tmpRotation.set(nd.r);
    tmpScale.set(nd.s);
    composeTRS(tmpTranslation, tmpRotation, tmpScale, out);
  });
}

export function bakeAnimations(
  character: CharacterData,
  clipSources: Map<string, AnimClip>,
  wanted: readonly ClipSource[],
  boneScale?: Map<string, number>,
): BakedAnimations {
  const { nodes, jointNodes, inverseBind } = character;
  const jointCount = jointNodes.length;

  const metas: BakedClipMeta[] = [];
  const resolvedClips: AnimClip[] = [];
  let totalFrames = 0;
  for (const w of wanted) {
    const clip = clipSources.get(w.name);
    if (!clip) throw new Error(`animation clip not found: ${w.name}`);
    resolvedClips.push(clip);
    const frames = Math.max(2, Math.round(clip.duration * BAKE_FPS) + 1);
    metas.push({
      name: w.name,
      frameOffset: totalFrames,
      frameCount: frames,
      duration: clip.duration,
      loop: w.loop,
    });
    totalFrames += frames;
  }

  const data = new Float32Array(totalFrames * jointCount * 16);
  const skinMat = new Float32Array(16);

  for (let ci = 0; ci < wanted.length; ci++) {
    const clip = resolvedClips[ci];
    const meta = metas[ci];
    const channels = indexChannels(clip);

    for (let f = 0; f < meta.frameCount; f++) {
      const t = Math.min(f / BAKE_FPS, clip.duration);
      const globals = computeGlobals(nodes, clipLocalOf(nodes, channels, t, boneScale));

      const frameBase = (meta.frameOffset + f) * jointCount * 16;
      for (let j = 0; j < jointCount; j++) {
        const g = globals.subarray(jointNodes[j] * 16, jointNodes[j] * 16 + 16);
        const ib = inverseBind.subarray(j * 16, j * 16 + 16);
        mat4.multiply(g, ib, skinMat);
        data.set(skinMat, frameBase + j * 16);
      }
    }
  }

  return { data, clips: metas, jointCount };
}

export function footPlantPhases(
  character: CharacterData,
  clip: AnimClip,
  footJointNames: readonly string[],
): number[] {
  const { nodes } = character;
  const channels = indexChannels(clip);
  const frameCount = Math.max(2, Math.round(clip.duration * BAKE_FPS) + 1);
  const footNodes = footJointNames
    .map((n) => nodes.findIndex((nd) => nd.name === n))
    .filter((i) => i >= 0);
  const minY = footNodes.map(() => Infinity);
  const minF = footNodes.map(() => 0);
  for (let f = 0; f < frameCount - 1; f++) {
    const t = Math.min(f / BAKE_FPS, clip.duration);
    const globals = computeGlobals(nodes, clipLocalOf(nodes, channels, t));
    footNodes.forEach((ni, k) => {
      const y = globals[ni * 16 + 13];
      if (y < minY[k]) {
        minY[k] = y;
        minF[k] = f;
      }
    });
  }
  return minF.map((f) => f / frameCount);
}

export function attachMeshToJoint(
  character: CharacterData,
  attach: {
    positions: Float32Array;
    normals: Float32Array;
    uvs: Float32Array;
    indices: Uint32Array;
  },
  jointName: string,
): void {
  const jointIdx = character.jointNodes.findIndex((ni) => character.nodes[ni].name === jointName);
  if (jointIdx < 0) throw new Error(`joint not found: ${jointName}`);

  const globals = restGlobals(character);
  const g = globals.subarray(
    character.jointNodes[jointIdx] * 16,
    character.jointNodes[jointIdx] * 16 + 16,
  );

  const vcount = attach.positions.length / 3;
  const pos = new Float32Array(attach.positions.length);
  const nrm = new Float32Array(attach.normals.length);
  const p = new Float32Array(3);
  for (let v = 0; v < vcount; v++) {
    vec3.transformMat4(attach.positions.subarray(v * 3, v * 3 + 3), g, p);
    pos.set(p, v * 3);
    vec3.transformMat4Upper3x3(attach.normals.subarray(v * 3, v * 3 + 3), g, p);
    vec3.normalize(p, p);
    nrm.set(p, v * 3);
  }

  const mesh = character.mesh;
  if (!mesh.joints || !mesh.weights) {
    throw new Error('attachMeshToJoint requires a skinned mesh');
  }
  const baseVert = mesh.positions.length / 3;
  const joints = new Uint32Array(vcount * 4);
  const weights = new Float32Array(vcount * 4);
  for (let v = 0; v < vcount; v++) {
    joints[v * 4] = jointIdx;
    weights[v * 4] = 1;
  }
  const shiftedIdx = new Uint32Array(attach.indices.length);
  for (let i = 0; i < attach.indices.length; i++) shiftedIdx[i] = attach.indices[i] + baseVert;

  mesh.positions = concat([mesh.positions, pos], Float32Array);
  mesh.normals = concat([mesh.normals, nrm], Float32Array);
  mesh.uvs = concat([mesh.uvs, attach.uvs], Float32Array);
  mesh.joints = concat([mesh.joints, joints], Uint32Array);
  mesh.weights = concat([mesh.weights, weights], Float32Array);
  mesh.indices = concat([mesh.indices, shiftedIdx], Uint32Array);
}
