import assert from 'node:assert/strict';
import test from 'node:test';
import { createFrameCadence } from '../src/renderer/cadence.ts';

test('uncapped cadence draws every tick with the full elapsed time', () => {
  const cadence = createFrameCadence(0);
  assert.equal(cadence.tick(0.01), 0.01);
  assert.equal(cadence.tick(0.02), 0.02);
});

test('30 Hz cadence accumulates skipped 60 Hz frames', () => {
  const cadence = createFrameCadence(30);
  const draws = [];
  for (let frame = 0; frame < 60; frame++) {
    const elapsed = cadence.tick(1 / 60);
    if (elapsed !== null) draws.push(elapsed);
  }
  assert.equal(draws.length, 30);
  assert(draws.slice(1).every((dt) => Math.abs(dt - 1 / 30) < 1e-9));
  cadence.invalidate();
  const tail = cadence.tick(0);
  assert.notEqual(tail, null);
  assert(Math.abs(draws.reduce((sum, dt) => sum + dt, tail) - 1) < 1e-9);
});

test('cadence preserves large steps and invalidation forces the next draw', () => {
  const cadence = createFrameCadence(30);
  assert.equal(cadence.tick(0.01), 0.01);
  assert.equal(cadence.tick(0.01), null);
  cadence.invalidate();
  assert(Math.abs(cadence.tick(0.005) - 0.015) < 1e-9);
  assert.equal(cadence.tick(0.1), 0.1);
});
