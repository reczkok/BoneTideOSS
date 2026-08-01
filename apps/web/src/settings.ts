import {
  type BaseSettings,
  createSettings,
  type GraphicsSettings,
} from '@bonetide/engine/game/settings.ts';

export type { GraphicsSettings };
export type Settings = BaseSettings;

const coarsePointer = () =>
  typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches ?? false);

export const {
  defaultSettings,
  parseSettings,
  loadSettings,
  saveSettings,
  needsRebuild,
  needsResize,
  canvasScale,
} = createSettings<Record<string, never>>({
  coarse: coarsePointer(),
  extras: {},
});
