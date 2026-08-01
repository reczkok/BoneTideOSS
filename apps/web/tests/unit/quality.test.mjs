import assert from 'node:assert/strict';
import test from 'node:test';
import { bakedRenderQuality, liveRenderOptions } from '@bonetide/engine/renderer/quality.ts';
import { defaultSettings, needsRebuild, needsResize } from '../../src/settings.ts';

test('baked and live render settings are classified explicitly', () => {
  const base = defaultSettings();
  assert.equal(needsRebuild(base, { ...base, rays: !base.rays }), false);
  assert.equal(needsRebuild(base, { ...base, fxaa: !base.fxaa }), false);
  assert.equal(needsRebuild(base, { ...base, particles: 0.4 }), false);
  assert.equal(needsRebuild(base, { ...base, canvasDprCap: 1.5 }), false);
  assert.equal(needsRebuild(base, { ...base, shadowSize: 4096 }), true);
  assert.equal(needsRebuild(base, { ...base, msaa: base.msaa === 1 ? 4 : 1 }), true);
  assert.equal(needsRebuild(base, { ...base, grassDensity: 0.35 }), true);

  assert.equal(needsResize(base, { ...base, canvasDprCap: 1.5 }), true);
  assert.equal(needsResize(base, { ...base, rays: !base.rays }), false);
  assert.equal(needsResize(base, { ...base, fxaa: !base.fxaa }), false);
  assert.equal(needsResize(base, { ...base, shadowSize: 4096 }), false);

  assert.deepEqual(bakedRenderQuality(base), {
    shadowSize: base.shadowSize,
    msaa: base.msaa,
  });
  assert.deepEqual(liveRenderOptions(base), { fxaa: base.fxaa, rays: base.rays });
});
