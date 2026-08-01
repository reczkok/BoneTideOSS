import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { AUDIO_REQUIREMENTS, GAME_ASSET_PATHS } from '../src/assets/requirements.ts';
import { SOUNDS, SOUND_IDS } from '../src/audio/manifest.ts';

test('asset and audio requirements are complete and deterministic', () => {
  assert.equal(new Set(GAME_ASSET_PATHS).size, GAME_ASSET_PATHS.length);
  assert(GAME_ASSET_PATHS.every((path) => !path.startsWith('/') && !path.includes('..')));
  const expectedAudio = Object.values(SOUNDS).reduce(
    (sum, sound) => sum + (sound.variants ?? 1),
    0,
  );
  assert.equal(AUDIO_REQUIREMENTS.length, expectedAudio);
  assert(AUDIO_REQUIREMENTS.some(({ stem, tier }) => stem === 'dash_2' && tier === 'core'));
  assert(
    AUDIO_REQUIREMENTS.some(({ stem, tier }) => stem === 'footstep_grass_6' && tier === 'core'),
  );

  const brief = readFileSync(resolve('sounds.md'), 'utf8');
  for (const id of SOUND_IDS) {
    assert(brief.includes(`\`${id}\``), `${id} missing from sounds.md`);
  }

  const stems = new Set(AUDIO_REQUIREMENTS.map(({ stem }) => stem));
  const audioFiles = spawnSync('git', ['ls-files', 'assets/audio'], { encoding: 'utf8' })
    .stdout.trim()
    .split('\n')
    .filter((path) => /\.(?:ogg|mp3|m4a|wav)$/i.test(path))
    .map((path) =>
      path
        .split('/')
        .at(-1)
        .replace(/\.(?:ogg|mp3|m4a|wav)$/i, ''),
    );
  assert.deepEqual(
    audioFiles.filter((stem) => !stems.has(stem)),
    [],
  );
});
