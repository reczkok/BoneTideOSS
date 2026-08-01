import assert from 'node:assert/strict';
import test from 'node:test';
import { ENEMY_TYPES, isBossWave, MAX_ENEMIES, waveComposition } from '../src/config.ts';
import { CLIP, CLIP_SOURCES, ENEMY_CLIP_COUNT } from '../src/core/animation.ts';
import { TREE } from '../src/game/tree.ts';

test('enemy partitions and wave boss rules stay coherent', () => {
  let cursor = 0;
  for (const enemy of ENEMY_TYPES) {
    assert.equal(enemy.slotStart, cursor);
    assert.equal(enemy.slotEnd, enemy.slotStart + enemy.slots);
    cursor = enemy.slotEnd;
  }
  assert.equal(cursor, MAX_ENEMIES);

  for (let wave = 1; wave <= 40; wave++) {
    const bossCount = waveComposition(wave).find(([type]) => ENEMY_TYPES[type].boss)?.[1] ?? 0;
    assert.equal(bossCount > 0, isBossWave(wave));
    assert.equal(isBossWave(wave), wave >= 10 && wave % 5 === 0);
  }
});

test('tree ids, tiers and animation indices preserve their contracts', () => {
  assert.equal(new Set(TREE.map((node) => node.id)).size, TREE.length);
  for (const node of TREE) {
    assert(node.maxRanks >= 1);
    if (node.tier > 1) {
      assert(
        TREE.some(
          (candidate) => candidate.branch === node.branch && candidate.tier === node.tier - 1,
        ),
      );
    }
  }

  assert.equal(ENEMY_CLIP_COUNT, CLIP.EBASH + 1);
  assert.equal(CLIP_SOURCES.length, Object.keys(CLIP).length);
  assert.deepEqual(
    Object.values(CLIP),
    Array.from({ length: CLIP_SOURCES.length }, (_, index) => index),
  );
});
