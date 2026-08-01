import assert from 'node:assert/strict';
import test from 'node:test';
import { SLOT_COUNT } from '../src/config.ts';
import { parseSave } from '../src/game/save.ts';

test('v3 saves are stable and sanitize corrupted fields', () => {
  const save = {
    version: 3,
    savedAt: 123,
    wave: 7,
    level: 4,
    xp: 12.5,
    points: 2,
    nodes: { 'k-damage': 2 },
    slots: ['meteor', null, 'chain', null, null],
    ultCharge: 0.5,
    hp: 77,
    time: 90,
    kills: 42,
    difficulty: 'normal',
  };
  assert.deepEqual(parseSave(JSON.stringify(save)), save);
  assert.equal(parseSave('{broken'), null);
  assert.equal(parseSave(JSON.stringify({ ...save, version: 2 })), null);

  const parsed = parseSave(
    JSON.stringify({ ...save, wave: -2, hp: -10, ultCharge: 7, slots: ['invalid'] }),
  );
  assert(parsed);
  assert.equal(parsed.wave, 1);
  assert.equal(parsed.hp, 1);
  assert.equal(parsed.ultCharge, 1);
  assert.equal(parsed.slots.length, SLOT_COUNT);
  assert(parsed.slots.every((slot) => slot === null));
});
