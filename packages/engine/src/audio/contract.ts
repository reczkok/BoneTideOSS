import type { SoundId } from './manifest.ts';

export interface PlayOpts {
  x?: number;
  z?: number;
  gain?: number;
  rate?: number;
}

export type Sfx = (id: SoundId, opts?: PlayOpts) => void;

export type SfxLoop = (key: string, id: SoundId | null, opts?: PlayOpts) => void;

export type MusicTrack = 'menu' | 'battle' | 'boss';

export interface GameAudio {
  play: Sfx;
  loop: SfxLoop;
  setListener(x: number, z: number): void;
  music(track: MusicTrack | null): void;
  musicIntensity(v: number): void;
}
