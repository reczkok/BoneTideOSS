import { createSettings, type BaseSettings } from '@bonetide/engine/game/settings.ts';

export type Settings = BaseSettings;

export const { defaultSettings, loadSettings, saveSettings, canvasScale } = createSettings<
  Record<string, never>
>({
  coarse: true,
  extras: {},
  shadowCap: 2048,
});
