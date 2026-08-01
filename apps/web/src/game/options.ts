import { CAMERA, PARTICLE_DENSITY } from '@bonetide/engine/config.ts';
import type { GraphicsSettings, Settings } from '../settings.ts';

interface Choice<T> {
  label: string;
  value: T;
}

export function createOptionsUi(deps: {
  settings: Settings;
  apply(prev: GraphicsSettings): void;
  close(): void;
}) {
  const { settings } = deps;
  const rowsEl = document.getElementById('options-rows') as HTMLElement;
  const refreshers: (() => void)[] = [];

  const commit = (mutate: () => void) => {
    const prev = { ...settings };
    mutate();
    deps.apply(prev);
    for (const refresh of refreshers) refresh();
  };

  const section = (title: string) => {
    const el = document.createElement('div');
    el.className = 'opt-section';
    el.textContent = title;
    rowsEl.append(el);
  };

  const segmented = <K extends keyof Settings>(
    label: string,
    key: K,
    choices: Choice<Settings[K]>[],
  ) => {
    const row = document.createElement('div');
    row.className = 'opt-row';
    const name = document.createElement('span');
    name.className = 'opt-label';
    name.textContent = label;
    const group = document.createElement('div');
    group.className = 'opt-seg';
    const buttons = choices.map((choice) => {
      const btn = document.createElement('button');
      btn.className = 'opt-choice';
      btn.textContent = choice.label;
      btn.addEventListener('click', () =>
        commit(() => {
          settings[key] = choice.value;
        }),
      );
      group.append(btn);
      return btn;
    });
    refreshers.push(() => {
      choices.forEach((choice, i) => {
        buttons[i].classList.toggle('active', settings[key] === choice.value);
      });
    });
    row.append(name, group);
    rowsEl.append(row);
  };

  const slider = (
    label: string,
    key: keyof Settings & ('zoom' | 'volMaster' | 'volMusic' | 'volSfx'),
    min: number,
    max: number,
    step: number,
    format: (v: number) => string,
  ) => {
    const row = document.createElement('div');
    row.className = 'opt-row';
    const name = document.createElement('span');
    name.className = 'opt-label';
    name.textContent = label;
    const wrap = document.createElement('div');
    wrap.className = 'opt-slider';
    const range = document.createElement('input');
    range.type = 'range';
    range.className = 'opt-range';
    range.min = String(min);
    range.max = String(max);
    range.step = String(step);
    const value = document.createElement('span');
    value.className = 'opt-slider-val';
    range.addEventListener('input', () =>
      commit(() => {
        settings[key] = Number(range.value);
      }),
    );
    refreshers.push(() => {
      range.value = String(settings[key]);
      value.textContent = format(settings[key]);
    });
    wrap.append(range, value);
    row.append(name, wrap);
    rowsEl.append(row);
  };

  const percent = (v: number) => `${Math.round(v * 100)}%`;

  section('graphics');
  segmented('shadows', 'shadowSize', [
    { label: 'low', value: 1024 },
    { label: 'medium', value: 2048 },
    { label: 'high', value: 4096 },
  ]);
  segmented('anti-aliasing', 'msaa', [
    { label: 'off', value: 1 },
    { label: 'MSAA 4x', value: 4 },
  ]);
  segmented('FXAA', 'fxaa', [
    { label: 'off', value: false },
    { label: 'on', value: true },
  ]);
  segmented('god rays', 'rays', [
    { label: 'off', value: false },
    { label: 'on', value: true },
  ]);
  segmented('particles', 'particles', [
    { label: 'reduced', value: PARTICLE_DENSITY.tiers.reduced },
    { label: 'normal', value: PARTICLE_DENSITY.tiers.normal },
    { label: 'full', value: PARTICLE_DENSITY.tiers.full },
  ]);
  segmented('grass', 'grassDensity', [
    { label: 'sparse', value: 0.35 },
    { label: 'normal', value: 0.7 },
    { label: 'lush', value: 1 },
  ]);
  segmented('pixel density', 'canvasDprCap', [
    { label: '1x', value: 1 },
    { label: '1.25x', value: 1.25 },
    { label: '1.5x', value: 1.5 },
    { label: '1.75x', value: 1.75 },
  ]);

  section('camera');
  slider('distance', 'zoom', CAMERA.zoomMin, CAMERA.zoomMax, 0.05, (v) => `${v.toFixed(2)}x`);

  section('audio');
  slider('master', 'volMaster', 0, 1, 0.05, percent);
  slider('music', 'volMusic', 0, 1, 0.05, percent);
  slider('effects', 'volSfx', 0, 1, 0.05, percent);

  (document.getElementById('options-back') as HTMLElement).addEventListener('click', deps.close);

  const refresh = () => {
    for (const fn of refreshers) fn();
  };
  refresh();
  return { refresh };
}
