import { parse } from '@loaders.gl/core';
import { GLTFLoader } from '@loaders.gl/gltf';
import { decodeImage, loadBytes, registryFetch, toArrayBuffer } from '#platform/assets.ts';

type GltfJson = any;

interface GltfFile {
  json: GltfJson;
  accessor(
    i: number,
  ): Float32Array | Uint32Array | Uint16Array | Uint8Array | Int16Array | Int8Array;
}

const COMPONENT_ARRAYS = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
} as const;

const TYPE_COMPONENTS: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT4: 16,
};

export async function loadGltf(url: string): Promise<GltfFile> {
  const bytes = await loadBytes(url);
  const gltf = await parse(toArrayBuffer(bytes), GLTFLoader, {
    fetch: registryFetch,
    core: { baseUrl: url.slice(0, url.lastIndexOf('/') + 1) },
    gltf: { loadImages: false, decompressMeshes: false, normalize: false },
  });
  const json: GltfJson = gltf.json;
  const buffers: { arrayBuffer: ArrayBuffer; byteOffset: number }[] = gltf.buffers;

  function accessor(i: number) {
    const acc = json.accessors[i];
    const Arr = COMPONENT_ARRAYS[acc.componentType as keyof typeof COMPONENT_ARRAYS];
    const comps = TYPE_COMPONENTS[acc.type];
    const total = acc.count * comps;
    const out = new Arr(total);
    if (acc.bufferView === undefined) return out;

    const bv = json.bufferViews[acc.bufferView];
    const buf = buffers[bv.buffer];
    const base = buf.byteOffset + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const elemBytes = Arr.BYTES_PER_ELEMENT * comps;
    const stride = bv.byteStride ?? elemBytes;

    if (stride === elemBytes) {
      out.set(new Arr(buf.arrayBuffer, base, total));
    } else {
      for (let e = 0; e < acc.count; e++) {
        const src = new Arr(buf.arrayBuffer, base + e * stride, comps);
        out.set(src, e * comps);
      }
    }
    return out;
  }

  return { json, accessor };
}

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  joints?: Uint32Array;
  weights?: Float32Array;
}

interface Transform {
  t: [number, number, number];
  r: [number, number, number, number];
  s: [number, number, number];
}

const DEFAULT_T: [number, number, number] = [0, 0, 0];
const DEFAULT_R: [number, number, number, number] = [0, 0, 0, 1];
const DEFAULT_S: [number, number, number] = [1, 1, 1];

export interface SkeletonNode extends Transform {
  name: string;
  parent: number;
}

export interface CharacterData {
  mesh: MeshData;
  nodes: SkeletonNode[];
  jointNodes: number[];
  inverseBind: Float32Array;
}

function nodeTRS(node: GltfJson): Transform {
  if (node.matrix) {
    throw new Error(`node ${node.name} uses matrix transform; TRS expected`);
  }
  return {
    t: node.translation ?? DEFAULT_T,
    r: node.rotation ?? DEFAULT_R,
    s: node.scale ?? DEFAULT_S,
  };
}

function extractNodes(json: GltfJson): SkeletonNode[] {
  const nodes: SkeletonNode[] = json.nodes.map((n: GltfJson) => ({
    name: n.name ?? '',
    parent: -1,
    ...nodeTRS(n),
  }));
  json.nodes.forEach((n: GltfJson, i: number) => {
    for (const c of n.children ?? []) nodes[c].parent = i;
  });
  return nodes;
}

function toUint32Joints(arr: ArrayLike<number>): Uint32Array {
  const out = new Uint32Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = arr[i];
  return out;
}

function normalizeWeights(raw: Float32Array | Uint16Array | Uint8Array): Float32Array {
  if (raw instanceof Float32Array) return raw;
  const scale = raw instanceof Uint8Array ? 1 / 255 : 1 / 65535;
  const out = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw[i] * scale;
  return out;
}

export const concat = <T extends Float32Array | Uint32Array>(
  parts: T[],
  Ctor: new (n: number) => T,
): T => {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Ctor(total);
  let off = 0;
  for (const p of parts) {
    out.set(p as never, off);
    off += p.length;
  }
  return out;
};

function mergeMeshes(file: GltfFile, meshIndices: number[], skinned: boolean): MeshData {
  const pos: Float32Array[] = [];
  const nrm: Float32Array[] = [];
  const uv: Float32Array[] = [];
  const jnt: Uint32Array[] = [];
  const wgt: Float32Array[] = [];
  const idx: Uint32Array[] = [];
  let vertBase = 0;

  for (const mi of meshIndices) {
    for (const prim of file.json.meshes[mi].primitives) {
      const a = prim.attributes;
      const p = file.accessor(a.POSITION) as Float32Array;
      const count = p.length / 3;
      pos.push(p);
      nrm.push(file.accessor(a.NORMAL) as Float32Array);
      uv.push(file.accessor(a.TEXCOORD_0) as Float32Array);
      if (skinned) {
        jnt.push(toUint32Joints(file.accessor(a.JOINTS_0)));
        wgt.push(
          normalizeWeights(file.accessor(a.WEIGHTS_0) as Float32Array | Uint16Array | Uint8Array),
        );
      }
      const rawIdx = file.accessor(prim.indices);
      const shifted = new Uint32Array(rawIdx.length);
      for (let i = 0; i < rawIdx.length; i++) shifted[i] = rawIdx[i] + vertBase;
      idx.push(shifted);
      vertBase += count;
    }
  }

  return {
    positions: concat(pos, Float32Array),
    normals: concat(nrm, Float32Array),
    uvs: concat(uv, Float32Array),
    indices: concat(idx, Uint32Array),
    ...(skinned ? { joints: concat(jnt, Uint32Array), weights: concat(wgt, Float32Array) } : {}),
  };
}

export async function loadCharacter(url: string): Promise<CharacterData> {
  const file = await loadGltf(url);
  const json = file.json;
  const skin = json.skins[0];
  const meshNodeIndices = json.nodes
    .map((n: GltfJson, i: number) => ({ n, i }))
    .filter(({ n }: { n: GltfJson }) => n.mesh !== undefined && n.skin !== undefined);

  const mesh = mergeMeshes(
    file,
    meshNodeIndices.map(({ n }: { n: GltfJson }) => n.mesh),
    true,
  );

  return {
    mesh,
    nodes: extractNodes(json),
    jointNodes: skin.joints,
    inverseBind: file.accessor(skin.inverseBindMatrices) as Float32Array,
  };
}

export async function loadProp(url: string): Promise<MeshData> {
  const file = await loadGltf(url);
  const meshIndices = file.json.nodes
    .filter((n: GltfJson) => n.mesh !== undefined)
    .map((n: GltfJson) => n.mesh);
  return mergeMeshes(file, meshIndices, false);
}

export interface AnimChannel {
  nodeName: string;
  path: 'translation' | 'rotation' | 'scale';
  times: Float32Array;
  values: Float32Array;
}

export interface AnimClip {
  name: string;
  duration: number;
  channels: AnimChannel[];
}

export async function loadClips(url: string): Promise<Map<string, AnimClip>> {
  const file = await loadGltf(url);
  const json = file.json;
  const clips = new Map<string, AnimClip>();

  for (const anim of json.animations ?? []) {
    const channels: AnimChannel[] = [];
    let duration = 0;
    for (const ch of anim.channels) {
      const sampler = anim.samplers[ch.sampler];
      const times = file.accessor(sampler.input) as Float32Array;
      const values = file.accessor(sampler.output) as Float32Array;
      const nodeName = json.nodes[ch.target.node].name ?? '';
      duration = Math.max(duration, times[times.length - 1]);
      channels.push({ nodeName, path: ch.target.path, times, values });
    }
    clips.set(anim.name, { name: anim.name, duration, channels });
  }
  return clips;
}

export async function loadTexture(url: string): Promise<ImageBitmap> {
  const bytes = await loadBytes(url);
  return decodeImage(bytes);
}
