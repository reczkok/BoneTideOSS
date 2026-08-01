import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultSettings, parseSettings } from '../../src/settings.ts';

test('settings validation preserves valid fields and defaults corrupted input', () => {
  assert.deepEqual(parseSettings(null), defaultSettings());
  assert.deepEqual(parseSettings({ version: 99, rays: false }), defaultSettings());

  const base = defaultSettings();
  const parsed = parseSettings({
    version: 1,
    rays: false,
    msaa: 9,
    zoom: 999,
    volMusic: 0.25,
    particles: false,
    shadowSize: 4096,
  });
  assert.equal(parsed.rays, false);
  assert.equal(parsed.msaa, base.msaa, 'an invalid msaa falls back to the default');
  assert.equal(parsed.zoom, base.zoom, 'an out-of-range zoom falls back to the default');
  assert.equal(parsed.volMusic, 0.25);
  assert.equal(parsed.particles, base.particles, 'a non-tier particles value is rejected');
  assert.equal(parsed.shadowSize, 4096);
});

test('unknown and out-of-range fields never reach the settings record', () => {
  const base = defaultSettings();
  const parsed = parseSettings({ version: 1, canvasDprCap: 9, grassDensity: 4, nonsense: true });
  assert.equal(parsed.canvasDprCap, base.canvasDprCap);
  assert.equal(parsed.grassDensity, base.grassDensity);
  assert.equal('nonsense' in parsed, false);
});
