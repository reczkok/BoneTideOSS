import assert from 'node:assert/strict';
import test from 'node:test';
import { d } from 'typegpu';
import {
  ActorSnap,
  CrescentWave,
  SimParams,
  TelegraphEntry,
  VolleyArrow,
} from '../src/core/schemas.ts';

const offset = (schema, field) => d.memoryLayoutOf(schema, (value) => value[field]).offset;

test('GPU schemas keep their exact sizes and readback offsets', () => {
  assert.equal(d.sizeOf(ActorSnap), 32);
  assert.deepEqual(
    Object.fromEntries(
      ['pos', 'heading', 'state', 'flags', 'hp', 'stun'].map((key) => [
        key,
        offset(ActorSnap, key),
      ]),
    ),
    { pos: 0, heading: 8, state: 12, flags: 16, hp: 20, stun: 24 },
  );

  assert.equal(d.sizeOf(VolleyArrow), 32);
  assert.deepEqual(
    Object.fromEntries(
      ['origin', 'dir', 'start', 'damage'].map((key) => [key, offset(VolleyArrow, key)]),
    ),
    { origin: 0, dir: 8, start: 16, damage: 20 },
  );

  assert.equal(d.sizeOf(CrescentWave), 32);
  assert.deepEqual(
    Object.fromEntries(
      ['origin', 'dir', 'start', 'damage', 'kind'].map((key) => [key, offset(CrescentWave, key)]),
    ),
    { origin: 0, dir: 8, start: 16, damage: 20, kind: 24 },
  );

  assert.equal(d.sizeOf(TelegraphEntry), 48);
  assert.deepEqual(
    Object.fromEntries(
      ['pos', 'dir', 'radius', 'halfArc', 't0', 't1', 'kind'].map((key) => [
        key,
        offset(TelegraphEntry, key),
      ]),
    ),
    { pos: 0, dir: 8, radius: 16, halfArc: 20, t0: 24, t1: 28, kind: 32 },
  );

  assert.equal(d.sizeOf(SimParams), 168);
  assert.deepEqual(
    Object.fromEntries(
      ['playerPos', 'wellPos', 'spikeOrigin', 'bladeCount', 'enemySpeedMul'].map((key) => [
        key,
        offset(SimParams, key),
      ]),
    ),
    { playerPos: 0, wellPos: 80, spikeOrigin: 96, bladeCount: 152, enemySpeedMul: 164 },
  );
});
