import assert from 'node:assert/strict';
import test from 'node:test';
import { BLADES, PLAYER } from '../src/config.ts';
import { createRunStats } from '../src/game/stats.ts';

test('stat folds are order-independent and apply adds before multipliers', () => {
  const mods = [
    { kind: 'mult', stat: 'player.attackDamage', factor: 2 },
    { kind: 'add', stat: 'player.attackDamage', amount: 10 },
  ];
  const a = createRunStats();
  const b = createRunStats();
  a.apply(mods);
  b.apply(mods.toReversed());
  assert.equal(a.player.attackDamage, (PLAYER.attackDamage + 10) * 2);
  assert.equal(a.player.attackDamage, b.player.attackDamage);
});

test('caps, resets, unlocks, blades and keystones fold deterministically', () => {
  const stats = createRunStats();
  stats.apply([
    { kind: 'add', stat: 'player.attackArcDeg', amount: 999 },
    { kind: 'unlock', ability: 'blades' },
    { kind: 'blades', count: 999 },
    { kind: 'keystone', id: 'crescent' },
  ]);
  assert.equal(stats.player.attackArcDeg, 170);
  assert.equal(stats.bladeCount, BLADES.maxCount);
  assert(stats.unlocked.has('blades'));
  assert(stats.keystones.has('crescent'));

  stats.reset();
  assert.equal(stats.player.attackArcDeg, PLAYER.attackArcDeg);
  assert.equal(stats.bladeCount, 0);
  assert.deepEqual([...stats.unlocked], ['nova']);
  assert.equal(stats.keystones.size, 0);
});
