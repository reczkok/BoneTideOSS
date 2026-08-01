import type {
  StorageFlag,
  TgpuBuffer,
  TgpuRoot,
  TgpuTexture,
  IndexFlag,
  VertexFlag,
  SampledFlag,
} from 'typegpu';
import { d } from 'typegpu';
import { mat4, vec3 } from 'wgpu-matrix';
import { type BakedClipMeta, bakeAnimations, attachMeshToJoint, footPlantPhases } from './anim.ts';
import {
  type CharacterData,
  loadCharacter,
  loadClips,
  loadProp,
  loadTexture,
  type MeshData,
} from './gltf.ts';
import { ENEMY_TYPES, LOCO } from '../config.ts';
import { CLIP, CLIP_SOURCES, ENEMY_CLIP_COUNT } from '../core/animation.ts';
import { saturate } from '../core/mathx.ts';
import { PROP_FILES } from './requirements.ts';
import { JOINTS, PropVertex, SkinnedDeformVertex, SkinnedShadeVertex } from '../core/schemas.ts';
import { loadBytes } from '#platform/assets.ts';
import {
  PLACEHOLDER_TWISTS,
  placeholderBake,
  placeholderCharacterMesh,
  placeholderFigureFor,
  placeholderPropMesh,
  placeholderTexture,
  placeholderWeaponMesh,
} from './placeholder.ts';

export interface CharacterAssets {
  deformBuf: TgpuBuffer<d.Disarray<typeof SkinnedDeformVertex>> & VertexFlag;
  shadeBuf: TgpuBuffer<d.Disarray<typeof SkinnedShadeVertex>> & VertexFlag;
  indexBuf: TgpuBuffer<d.WgslArray<d.U16>> & IndexFlag;
  indexCount: number;
  animBuf: TgpuBuffer<d.WgslArray<d.Mat4x4f>> & StorageFlag;
  texture: TgpuTexture & SampledFlag;
}

export interface PropAssets {
  vertexBuf: TgpuBuffer<d.Disarray<typeof PropVertex>> & VertexFlag;
  indexBuf: TgpuBuffer<d.WgslArray<d.U16>> & IndexFlag;
  indexCount: number;
}

export interface GameAssets {
  knight: CharacterAssets;
  enemies: CharacterAssets[];
  clips: BakedClipMeta[];
  props: Map<string, PropAssets>;
  propFootprints: Map<string, number>;
  spectral: { blade: PropAssets; arrow: PropAssets };
  forestTex: TgpuTexture & SampledFlag;
  twistFactors: number[];
}

const gameAsset = (path: string) => `game/${path}`;

const packSnorm16 = (v: number) => Math.round(Math.max(-1, Math.min(1, v)) * 32767);
const packUnorm16 = (v: number) => Math.round(saturate(v) * 65535);

function checkUv(v: number): number {
  if (v < -0.001 || v > 1.001) {
    throw new Error(`mesh uv ${v} outside [0,1]: unorm16 packing needs atlas UVs`);
  }
  return v;
}

function uploadIndices(root: TgpuRoot, mesh: MeshData, vertexCount: number) {
  if (vertexCount > 0xffff) {
    throw new Error(`mesh has ${vertexCount} verts: too many for u16 indices`);
  }
  const padded = new Uint16Array((mesh.indices.length + 1) & ~1);
  padded.set(mesh.indices);
  const indexBuf = root.createBuffer(d.arrayOf(d.u16, padded.length)).$usage('index');
  root.device.queue.writeBuffer(indexBuf.buffer, 0, padded);
  return { indexBuf, indexCount: mesh.indices.length };
}

function uploadSkinnedMesh(
  root: TgpuRoot,
  mesh: MeshData,
): Omit<CharacterAssets, 'animBuf' | 'texture'> {
  if (!mesh.joints || !mesh.weights) {
    throw new Error('uploadSkinnedMesh requires a skinned mesh');
  }
  const vertexCount = mesh.positions.length / 3;
  const deform = new ArrayBuffer(vertexCount * 24);
  const dF32 = new Float32Array(deform);
  const dU8 = new Uint8Array(deform);
  const dU16 = new Uint16Array(deform);
  const shade = new ArrayBuffer(vertexCount * 12);
  const sI16 = new Int16Array(shade);
  const sU16 = new Uint16Array(shade);
  for (let i = 0; i < vertexCount; i++) {
    dF32[i * 6] = mesh.positions[i * 3];
    dF32[i * 6 + 1] = mesh.positions[i * 3 + 1];
    dF32[i * 6 + 2] = mesh.positions[i * 3 + 2];
    for (let k = 0; k < 4; k++) {
      const joint = mesh.joints[i * 4 + k];
      if (joint > 0xff) throw new Error(`joint index ${joint} exceeds u8`);
      dU8[i * 24 + 12 + k] = joint;
      dU16[i * 12 + 8 + k] = packUnorm16(mesh.weights[i * 4 + k]);
      sI16[i * 6 + k] = k < 3 ? packSnorm16(mesh.normals[i * 3 + k]) : 0;
    }
    sU16[i * 6 + 4] = packUnorm16(checkUv(mesh.uvs[i * 2]));
    sU16[i * 6 + 5] = packUnorm16(checkUv(mesh.uvs[i * 2 + 1]));
  }
  const deformBuf = root
    .createBuffer(d.disarrayOf(SkinnedDeformVertex, vertexCount))
    .$usage('vertex');
  root.device.queue.writeBuffer(deformBuf.buffer, 0, deform);
  const shadeBuf = root
    .createBuffer(d.disarrayOf(SkinnedShadeVertex, vertexCount))
    .$usage('vertex');
  root.device.queue.writeBuffer(shadeBuf.buffer, 0, shade);
  return { deformBuf, shadeBuf, ...uploadIndices(root, mesh, vertexCount) };
}

function uploadPropMesh(root: TgpuRoot, mesh: MeshData): PropAssets {
  const vertexCount = mesh.positions.length / 3;
  const packed = new ArrayBuffer(vertexCount * 24);
  const pF32 = new Float32Array(packed);
  const pI16 = new Int16Array(packed);
  const pU16 = new Uint16Array(packed);
  for (let i = 0; i < vertexCount; i++) {
    pF32[i * 6] = mesh.positions[i * 3];
    pF32[i * 6 + 1] = mesh.positions[i * 3 + 1];
    pF32[i * 6 + 2] = mesh.positions[i * 3 + 2];
    pI16[i * 12 + 6] = packSnorm16(mesh.normals[i * 3]);
    pI16[i * 12 + 7] = packSnorm16(mesh.normals[i * 3 + 1]);
    pI16[i * 12 + 8] = packSnorm16(mesh.normals[i * 3 + 2]);
    pI16[i * 12 + 9] = 0;
    pU16[i * 12 + 10] = packUnorm16(checkUv(mesh.uvs[i * 2]));
    pU16[i * 12 + 11] = packUnorm16(checkUv(mesh.uvs[i * 2 + 1]));
  }
  const vertexBuf = root.createBuffer(d.disarrayOf(PropVertex, vertexCount)).$usage('vertex');
  root.device.queue.writeBuffer(vertexBuf.buffer, 0, packed);
  return { vertexBuf, ...uploadIndices(root, mesh, vertexCount) };
}

async function uploadTexture(root: TgpuRoot, url: string) {
  const bitmap = await loadTexture(url);
  const mips = Math.floor(Math.log2(Math.max(bitmap.width, bitmap.height))) + 1;
  const tex = root
    .createTexture({
      size: [bitmap.width, bitmap.height],
      format: 'rgba8unorm',
      mipLevelCount: mips,
    })
    .$usage('sampled', 'render');
  tex.write(bitmap);
  tex.generateMipmaps();
  return tex;
}

async function present(key: string): Promise<boolean> {
  try {
    await loadBytes(key);
    return true;
  } catch {
    return false;
  }
}

function placeholderCharacter(
  root: TgpuRoot,
  model: string,
  animBuf: CharacterAssets['animBuf'],
  texture: TgpuTexture & SampledFlag,
): CharacterAssets {
  const mesh = placeholderCharacterMesh(placeholderFigureFor(model));
  return { ...uploadSkinnedMesh(root, mesh), animBuf, texture };
}

export async function loadGameAssets(
  root: TgpuRoot,
  onProgress: (msg: string, frac: number) => void,
): Promise<GameAssets> {
  const totalUnits = 6 + 1 + 1 + ENEMY_TYPES.length + PROP_FILES.length + 2;
  let doneUnits = 0;
  const tick = (msg: string) => onProgress(msg, ++doneUnits / totalUnits);
  const counted = <T>(msg: string, p: Promise<T>) =>
    p.then((v) => {
      tick(msg);
      return v;
    });

  onProgress('summoning skeletons…', 0);
  const [haveCharacters, haveProps] = await Promise.all([
    present(gameAsset('characters/Knight.glb')),
    present(gameAsset('props/forest_texture.png')),
  ]);
  if (!haveCharacters || !haveProps) {
    console.warn(
      `assets: rendering placeholder ${[!haveCharacters && 'characters', !haveProps && 'props']
        .filter(Boolean)
        .join(' + ')}; see packages/engine/assets/README.md`,
    );
  }

  const forestTex = haveProps
    ? await counted(
        'growing the forest…',
        uploadTexture(root, gameAsset('props/forest_texture.png')),
      )
    : placeholderTexture(root);
  if (!haveProps) tick('growing the forest…');

  const props = new Map<string, PropAssets>();
  const propFootprints = new Map<string, number>();
  await Promise.all(
    PROP_FILES.map(async (name) => {
      const mesh = haveProps
        ? await loadProp(gameAsset(`props/${name}_Color1.gltf`))
        : placeholderPropMesh(name);
      let maxSq = 0;
      for (let i = 0; i < mesh.positions.length; i += 3) {
        const x = mesh.positions[i];
        const z = mesh.positions[i + 2];
        maxSq = Math.max(maxSq, x * x + z * z);
      }
      propFootprints.set(name, Math.sqrt(maxSq));
      props.set(name, uploadPropMesh(root, mesh));
      tick('growing the forest…');
    }),
  );

  if (!haveCharacters) {
    const bake = placeholderBake();
    const paletteTex = placeholderTexture(root);
    const animBuf = root
      .createBuffer(d.arrayOf(d.mat4x4f, bake.data.length / 16), bake.data)
      .$usage('storage');
    const knight = placeholderCharacter(root, 'Knight', animBuf, paletteTex);
    tick('baking animations…');
    const enemies = ENEMY_TYPES.map((et) => {
      const character = placeholderCharacter(root, et.model, animBuf, paletteTex);
      tick('raising the horde…');
      return character;
    });
    for (let i = doneUnits; i < totalUnits; i++) tick('forging spectral arms…');
    return {
      knight,
      enemies,
      clips: bake.clips,
      props,
      propFootprints,
      spectral: {
        blade: uploadPropMesh(root, placeholderWeaponMesh('blade')),
        arrow: uploadPropMesh(root, placeholderWeaponMesh('arrow')),
      },
      forestTex,
      twistFactors: PLACEHOLDER_TWISTS,
    };
  }

  const [
    knightChar,
    sword,
    generalClips,
    movementClips,
    meleeClips,
    rangedClips,
    advancedClips,
    knightTex,
  ] = await Promise.all([
    counted('summoning skeletons…', loadCharacter(gameAsset('characters/Knight.glb'))),
    counted('summoning skeletons…', loadProp(gameAsset('weapons/sword_1handed.gltf'))),
    counted('summoning skeletons…', loadClips(gameAsset('anims/Rig_Medium_General.glb'))),
    counted('summoning skeletons…', loadClips(gameAsset('anims/Rig_Medium_MovementBasic.glb'))),
    counted('summoning skeletons…', loadClips(gameAsset('anims/Rig_Medium_CombatMelee.glb'))),
    counted('summoning skeletons…', loadClips(gameAsset('anims/Rig_Medium_CombatRanged.glb'))),
    counted('summoning skeletons…', loadClips(gameAsset('anims/Rig_Medium_MovementAdvanced.glb'))),
    counted('summoning skeletons…', uploadTexture(root, gameAsset('weapons/knight_texture.png'))),
  ]);

  const allClips = new Map([
    ...generalClips,
    ...movementClips,
    ...meleeClips,
    ...rangedClips,
    ...advancedClips,
  ]);

  attachMeshToJoint(knightChar, sword, 'handslot.r');

  const knightBake = bakeAnimations(knightChar, allClips, CLIP_SOURCES);
  if (knightBake.jointCount !== JOINTS) {
    throw new Error(`expected ${JOINTS} joints, got ${knightBake.jointCount}`);
  }
  const runClip = allClips.get(CLIP_SOURCES[CLIP.RUN].name);
  if (!runClip) throw new Error(`missing clip ${CLIP_SOURCES[CLIP.RUN].name}`);
  const plants = footPlantPhases(knightChar, runClip, ['foot.l', 'foot.r']);
  if (plants.length > 0) knightBake.clips[CLIP.RUN].plantPhases = plants;
  tick('baking animations…');

  const twistFactors = knightChar.jointNodes.map((ni) => {
    const name = knightChar.nodes[ni].name;
    if (LOCO.lowerBodyJoints.includes(name)) return 1;
    return name === LOCO.spineJoint ? LOCO.spineTwist : 0;
  });

  const makeAnimBuf = (data: Float32Array) =>
    root.createBuffer(d.arrayOf(d.mat4x4f, data.length / 16), data).$usage('storage');

  const knight: CharacterAssets = {
    ...uploadSkinnedMesh(root, knightChar.mesh),
    animBuf: makeAnimBuf(knightBake.data),
    texture: knightTex,
  };

  const skeletonTex = await counted(
    'raising the horde…',
    uploadTexture(root, gameAsset('characters/skeleton_texture.png')),
  );
  const boneScaleMap = (char: CharacterData): Map<string, number> | undefined => {
    const map = new Map<string, number>();
    for (const ni of char.jointNodes) {
      const nd = char.nodes[ni];
      const ref =
        knightChar.nodes[
          knightChar.jointNodes.find((ki) => knightChar.nodes[ki].name === nd.name) ?? -1
        ];
      if (!ref) continue;
      const refMag = Math.hypot(ref.t[0], ref.t[1], ref.t[2]);
      if (refMag < 1e-4) continue;
      const ratio = Math.hypot(nd.t[0], nd.t[1], nd.t[2]) / refMag;
      if (Math.abs(ratio - 1) > 0.02) map.set(nd.name, ratio);
    }
    return map.size > 0 ? map : undefined;
  };

  const rotateMesh = (mesh: MeshData, [rx, ry, rz]: [number, number, number]) => {
    const m = mat4.rotationX((rx * Math.PI) / 180);
    mat4.rotateY(m, (ry * Math.PI) / 180, m);
    mat4.rotateZ(m, (rz * Math.PI) / 180, m);
    const v = vec3.create();
    for (const arr of [mesh.positions, mesh.normals]) {
      for (let i = 0; i < arr.length; i += 3) {
        vec3.set(arr[i], arr[i + 1], arr[i + 2], v);
        vec3.transformMat4Upper3x3(v, m, v);
        arr[i] = v[0];
        arr[i + 1] = v[1];
        arr[i + 2] = v[2];
      }
    }
  };

  const enemies: CharacterAssets[] = [];
  const animBufByModel = new Map<string, CharacterAssets['animBuf']>();
  for (const et of ENEMY_TYPES) {
    const char = await loadCharacter(gameAsset(`characters/${et.model}.glb`));
    for (const held of et.held ?? []) {
      const mesh = await loadProp(gameAsset(`weapons/${held.model}.gltf`));
      if (held.rotate) rotateMesh(mesh, held.rotate);
      attachMeshToJoint(char, mesh, held.joint);
    }
    let animBuf = animBufByModel.get(et.model);
    if (!animBuf) {
      const bake = bakeAnimations(
        char,
        allClips,
        CLIP_SOURCES.slice(0, ENEMY_CLIP_COUNT),
        boneScaleMap(char),
      );
      animBuf = makeAnimBuf(bake.data);
      animBufByModel.set(et.model, animBuf);
    }
    enemies.push({ ...uploadSkinnedMesh(root, char.mesh), animBuf, texture: skeletonTex });
    tick('raising the horde…');
  }

  const [bladeMesh, arrowMesh] = await Promise.all([
    counted('forging spectral arms…', loadProp(gameAsset('weapons/Skeleton_Blade.gltf'))),
    counted('forging spectral arms…', loadProp(gameAsset('weapons/Skeleton_Arrow.gltf'))),
  ]);

  return {
    knight,
    enemies,
    clips: knightBake.clips,
    props,
    propFootprints,
    spectral: {
      blade: uploadPropMesh(root, bladeMesh),
      arrow: uploadPropMesh(root, arrowMesh),
    },
    forestTex,
    twistFactors,
  };
}
