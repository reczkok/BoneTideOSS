import assert from 'node:assert/strict';
import test from 'node:test';
import { CLIP, CLIP_SOURCES } from '../src/core/animation.ts';
import { JOINTS } from '../src/core/schemas.ts';
import {
  PLACEHOLDER_TWISTS,
  placeholderBake,
  placeholderCharacterMesh,
  placeholderFigureFor,
  placeholderPropMesh,
  placeholderWeaponMesh,
} from '../src/assets/placeholder.ts';
import { PROP_FILES } from '../src/assets/requirements.ts';

const meshes = () => [
  placeholderCharacterMesh(placeholderFigureFor('Knight')),
  placeholderWeaponMesh('sword'),
  placeholderWeaponMesh('Skeleton_Arrow'),
  ...PROP_FILES.map((name) => placeholderPropMesh(name)),
];

test('placeholder meshes satisfy the loader packing constraints', () => {
  for (const mesh of meshes()) {
    const vertices = mesh.positions.length / 3;
    assert(vertices > 0, 'mesh is empty');
    assert(vertices <= 0xffff, 'u16 indices cannot address the mesh');
    assert.equal(mesh.normals.length, vertices * 3);
    assert.equal(mesh.uvs.length, vertices * 2);
    assert(
      mesh.indices.every((i) => i < vertices),
      'index out of range',
    );
    assert(
      mesh.uvs.every((uv) => uv >= 0 && uv <= 1),
      'uvs must be atlas-mapped for unorm16 packing',
    );
    assert(
      mesh.positions.every((v) => Number.isFinite(v)) && mesh.normals.every(Number.isFinite),
      'non-finite vertex data',
    );
  }
});

test('placeholder characters are skinned within the shader joint budget', () => {
  const mesh = placeholderCharacterMesh(placeholderFigureFor('Skeleton_Minion'));
  const vertices = mesh.positions.length / 3;
  assert.equal(mesh.joints?.length, vertices * 4);
  assert.equal(mesh.weights?.length, vertices * 4);
  assert(
    mesh.joints.every((j) => j < JOINTS),
    'joint index exceeds the rig',
  );
  for (let i = 0; i < vertices; i++) {
    const sum = mesh.weights.slice(i * 4, i * 4 + 4).reduce((a, b) => a + b, 0);
    assert(Math.abs(sum - 1) < 1e-5, 'skin weights must sum to 1');
  }
  assert.equal(PLACEHOLDER_TWISTS.length, JOINTS);
});

test('the placeholder bake covers every clip with contiguous frames', () => {
  const { data, clips } = placeholderBake();
  assert.equal(clips.length, CLIP_SOURCES.length);
  let frames = 0;
  for (const [i, clip] of clips.entries()) {
    assert.equal(clip.name, CLIP_SOURCES[i].name);
    assert.equal(clip.loop, CLIP_SOURCES[i].loop);
    assert.equal(clip.frameOffset, frames, 'clip frames must be contiguous');
    assert(clip.frameCount >= 2);
    assert(clip.duration > 0);
    frames += clip.frameCount;
  }
  assert.equal(data.length, frames * JOINTS * 16);
  assert(data.every(Number.isFinite), 'non-finite joint matrix');
  assert.deepEqual(clips[CLIP.RUN].plantPhases, [0.25, 0.75]);
});

test('every enemy model maps to a placeholder figure', () => {
  for (const model of ['Knight', 'Skeleton_Minion', 'Skeleton_Golem', 'Skeleton_Mage', 'Unknown']) {
    const figure = placeholderFigureFor(model);
    assert(figure.height > 0 && figure.bulk > 0);
  }
});
