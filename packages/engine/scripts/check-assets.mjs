import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AUDIO_REQUIREMENTS, GAME_ASSET_PATHS } from '../src/assets/requirements.ts';

const root = resolve(import.meta.dirname, '..');
const audioExtensions = ['.ogg', '.mp3', '.m4a', '.wav'];

const missingGame = GAME_ASSET_PATHS.filter(
  (path) => !existsSync(join(root, 'assets', 'game', path)),
);
const missingAudio = AUDIO_REQUIREMENTS.filter(
  ({ stem }) =>
    !audioExtensions.some((ext) => existsSync(join(root, 'assets', 'audio', stem + ext))),
);

if (missingGame.length === GAME_ASSET_PATHS.length) {
  console.log(
    `No game art installed (${GAME_ASSET_PATHS.length} files). The engine renders procedural placeholders.\nSee assets/README.md to install a real art pack.`,
  );
} else if (missingGame.length) {
  console.warn(`Partially installed game art: ${missingGame.length} file(s) missing:`);
  for (const path of missingGame) console.warn(`  assets/game/${path}`);
  console.warn(
    '\nThe loader only falls back to placeholders when NOTHING is installed; a partial\nset throws on the first missing file. Install the rest or remove assets/game.',
  );
} else {
  console.log('All game art present.');
}

console.log(
  missingAudio.length
    ? `${missingAudio.length}/${AUDIO_REQUIREMENTS.length} sounds missing; each one silently no-ops.`
    : 'All sounds present.',
);

process.exit(missingGame.length > 0 && missingGame.length < GAME_ASSET_PATHS.length ? 1 : 0);
