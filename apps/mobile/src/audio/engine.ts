import type { GameAudio } from '@bonetide/engine/audio/contract.ts';

export function createAudioEngine(): GameAudio {
  return {
    play() {},
    loop() {},
    setListener() {},
    music() {},
    musicIntensity() {},
  };
}
