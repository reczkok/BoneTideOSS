import { storage } from '#platform/storage.ts';
import { CAMERA, DPR, PARTICLE_DENSITY, type ParticleDensity } from '../config.ts';

export interface GraphicsSettings {
  canvasDprCap: number;
  shadowSize: 1024 | 2048 | 4096;
  msaa: 1 | 4;
  fxaa: boolean;
  rays: boolean;
  particles: ParticleDensity;
  grassDensity: number;
}

export interface BaseSettings extends GraphicsSettings {
  version: 1;
  zoom: number;
  volMaster: number;
  volMusic: number;
  volSfx: number;
}

const REBUILD_KEYS = ['shadowSize', 'msaa', 'grassDensity'] as const;

const RESIZE_KEYS = ['canvasDprCap'] as const;

const KEY = 'bonetide.settings.v1';

const isVol = (v: unknown): v is number => typeof v === 'number' && v >= 0 && v <= 1;
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isCanvasDprCap = (v: unknown): v is number =>
  typeof v === 'number' && v >= 1 && v <= DPR.canvasCap;
const isShadowSize = (v: unknown): v is 1024 | 2048 | 4096 =>
  v === 1024 || v === 2048 || v === 4096;
const isMsaa = (v: unknown): v is 1 | 4 => v === 1 || v === 4;
const isGrassDensity = (v: unknown): v is number => typeof v === 'number' && v > 0.1 && v <= 1;
const isZoom = (v: unknown): v is number =>
  typeof v === 'number' && v >= CAMERA.zoomMin && v <= CAMERA.zoomMax;
const isParticles = (v: unknown): v is ParticleDensity =>
  v === PARTICLE_DENSITY.tiers.reduced ||
  v === PARTICLE_DENSITY.tiers.normal ||
  v === PARTICLE_DENSITY.tiers.full;

export function createSettings<Extra extends Record<string, boolean | number>>(opts: {
  coarse: boolean;
  extras: Extra;
  extraAllowed?: { [K in keyof Extra]?: readonly Extra[K][] };
  shadowCap?: 1024 | 2048 | 4096;
}) {
  type Settings = BaseSettings & Extra;
  const { coarse, extras, extraAllowed } = opts;
  const extraKeys = Object.keys(extras) as (keyof Extra & string)[];

  const MSAA: 1 | 4 = coarse ? 1 : 4;
  const FXAA = MSAA === 1;
  const SHADOW_SIZE: 1024 | 2048 | 4096 = opts.shadowCap ?? 2048;

  const defaultGraphics = (): GraphicsSettings => ({
    canvasDprCap: DPR.canvasCap,
    shadowSize: SHADOW_SIZE,
    msaa: MSAA,
    fxaa: FXAA,
    rays: true,
    particles: PARTICLE_DENSITY.tiers.normal,
    grassDensity: 0.7,
  });

  const defaultSettings = (): Settings =>
    ({
      version: 1,
      ...defaultGraphics(),
      zoom: coarse ? CAMERA.coarseZoom : 1,
      volMaster: 0.75,
      volMusic: 0.5,
      volSfx: 1,
      ...extras,
    }) as Settings;

  function parseSettings(parsed: unknown): Settings {
    const base = defaultSettings();
    if (!parsed || typeof parsed !== 'object') return base;
    const value = parsed as Partial<Settings>;
    try {
      if (value.version !== 1) return base;
      const pick = <K extends keyof BaseSettings>(
        key: K,
        isValid: (v: unknown) => v is BaseSettings[K],
      ) => {
        const v = (value as Partial<BaseSettings>)[key];
        if (isValid(v)) (base as BaseSettings)[key] = v;
      };
      pick('canvasDprCap', isCanvasDprCap);
      pick('shadowSize', isShadowSize);
      pick('msaa', isMsaa);
      pick('fxaa', isBool);
      pick('rays', isBool);
      pick('particles', isParticles);
      pick('grassDensity', isGrassDensity);
      pick('zoom', isZoom);
      pick('volMaster', isVol);
      pick('volMusic', isVol);
      pick('volSfx', isVol);
      for (const key of extraKeys) {
        const v = (value as Record<string, unknown>)[key];
        const allowed = extraAllowed?.[key];
        const ok = allowed ? allowed.includes(v as Extra[typeof key]) : isBool(v);
        if (ok) (base as Record<string, boolean | number>)[key] = v as boolean | number;
      }
    } catch {}
    return base;
  }

  function loadSettings(): Settings {
    try {
      const raw = storage.get(KEY);
      return raw ? parseSettings(JSON.parse(raw)) : defaultSettings();
    } catch {
      return defaultSettings();
    }
  }

  function saveSettings(s: Settings) {
    try {
      storage.set(KEY, JSON.stringify(s));
    } catch {}
  }

  function needsRebuild(prev: GraphicsSettings, next: GraphicsSettings): boolean {
    return REBUILD_KEYS.some((k) => prev[k] !== next[k]);
  }

  function needsResize(prev: GraphicsSettings, next: GraphicsSettings): boolean {
    return RESIZE_KEYS.some((k) => prev[k] !== next[k]);
  }

  function canvasScale(s: GraphicsSettings, deviceDpr: number): number {
    return Math.min(deviceDpr, s.canvasDprCap, DPR.canvasCap);
  }

  return {
    defaultSettings,
    parseSettings,
    loadSettings,
    saveSettings,
    needsRebuild,
    needsResize,
    canvasScale,
  };
}
