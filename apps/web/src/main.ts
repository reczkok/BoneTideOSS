import tgpu, { d, type TgpuRoot } from 'typegpu';
import { loadGameAssets } from '@bonetide/engine/assets/assets.ts';
import { createAudioEngine } from './audio/engine.ts';
import {
  AUDIO,
  type Difficulty,
  MAX_ENEMIES,
  MAX_PARTICLES,
  REVEAL,
} from '@bonetide/engine/config.ts';
import { type AppState, createApp } from './game/app.ts';
import { createCamera } from '@bonetide/engine/game/camera.ts';
import { createRun } from '@bonetide/engine/game/game.ts';
import { createHud } from './game/hud.ts';
import { createInput } from './game/input.ts';
import { createTouchControls } from './game/touch.ts';
import { createKeymapUi } from './game/keymap.ts';
import { createTreeUi } from './game/treeui.ts';
import { createOptionsUi } from './game/options.ts';
import { ActorReadback } from '@bonetide/engine/game/readback.ts';
import { createRunStats } from '@bonetide/engine/game/stats.ts';
import { setEffectDensity } from '@bonetide/engine/game/effects/pool.ts';
import { createRendererHandle } from '@bonetide/engine/renderer/handle.ts';
import { createRenderer } from '@bonetide/engine/renderer/renderer.ts';
import { bakedRenderQuality, liveRenderOptions } from '@bonetide/engine/renderer/quality.ts';
import { createVitalsOrbs } from './renderer/vitals.ts';
import { Actor, Particle } from '@bonetide/engine/core/schemas.ts';
import {
  canvasScale,
  type GraphicsSettings,
  loadSettings,
  needsRebuild,
  needsResize,
  saveSettings,
} from './settings.ts';
import { createSim } from '@bonetide/engine/sim/sim.ts';
import { rockColliders, scatterWorld } from '@bonetide/engine/core/world.ts';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = el<HTMLCanvasElement>('canvas');
const loadingNote = el('loading-note');
const loadFill = el('load-fill');
const overlay = el('overlay');
const nogpu = el('nogpu');
const startBtn = el<HTMLButtonElement>('start-btn');

function loadProgress(msg: string, frac: number) {
  loadingNote.textContent = msg;
  loadFill.style.width = `${Math.round(frac * 100)}%`;
}

let fatalShown = false;
let stopForFatal = () => {};

function showGpuFailure(title: string, reason: unknown) {
  if (fatalShown) return;
  fatalShown = true;
  stopForFatal();
  overlay.classList.add('hidden');
  nogpu.classList.remove('hidden');
  el('nogpu-title').textContent = title;
  el('nogpu-lead').textContent = reason instanceof Error ? reason.message : String(reason);
}

el<HTMLButtonElement>('nogpu-retry').addEventListener('click', () => location.reload());

async function boot() {
  let root: TgpuRoot;
  try {
    root = await tgpu.init();
  } catch (err) {
    showGpuFailure('WebGPU unavailable', 'This game needs a browser and device with WebGPU.');
    throw err;
  }

  let stopped = false;
  let stopAudio = () => {};
  stopForFatal = () => {
    stopped = true;
    stopAudio();
  };
  void root.device.lost.then((info) => {
    showGpuFailure('Graphics device lost', info.message || info.reason);
  });
  root.device.addEventListener('uncapturederror', (event) => {
    showGpuFailure('WebGPU validation error', event.error);
  });

  const assets = await loadGameAssets(root, (msg, frac) => loadProgress(msg, frac * 0.96));
  if (stopped) return;
  loadProgress('sharpening swords…', 0.98);

  const settings = loadSettings();
  let currentDifficulty: Difficulty = 'normal';
  let menuReady = false;
  setEffectDensity(settings.particles);

  const enemyBuf = root.createBuffer(d.arrayOf(Actor, MAX_ENEMIES)).$usage('storage');
  const playerBuf = root.createBuffer(d.arrayOf(Actor, 1)).$usage('storage');
  const particleBuf = root.createBuffer(d.arrayOf(Particle, MAX_PARTICLES)).$usage('storage');

  let scatter = scatterWorld(7, settings.grassDensity, assets.propFootprints);
  const colliders = rockColliders(scatter, assets.propFootprints);
  const sim = createSim(root, enemyBuf, particleBuf, assets.clips, colliders, settings.particles);
  const context = root.configureContext({ canvas });
  const renderer = createRendererHandle(() =>
    createRenderer(
      root,
      context,
      navigator.gpu.getPreferredCanvasFormat(),
      canvas,
      assets,
      scatter,
      {
        enemyBuf,
        playerBuf,
        particleBuf,
        trampleBuf: sim.trampleBuf,
        fieldTex: sim.fieldTex,
        chainBuf: sim.chainBuf,
        volleyBuf: sim.volleyBuf,
      },
      bakedRenderQuality(settings),
      liveRenderOptions(settings),
    ),
  );

  const app = createApp();
  const audio = createAudioEngine();
  stopAudio = () => {
    audio.stopAllLoops();
    audio.music(null);
  };
  audio.setVolumes(settings.volMaster, settings.volMusic, settings.volSfx);
  audio.preloadAll();
  audio.music('menu');
  const input = createInput(canvas, () => app.state === 'playing');
  const stats = createRunStats();
  const vitals = createVitalsOrbs(root);
  const hud = createHud(renderer.setScreenFx, vitals);
  const camera = createCamera(canvas, { write: (v) => renderer.camera.write(v) });
  camera.setZoom(settings.zoom);
  renderer.setZoom(settings.zoom);
  const readback = new ActorReadback(root.device, sim.actorSnapBuf);

  const makeRun = () =>
    createRun({
      app,
      renderer,
      sim,
      enemyBuf,
      playerBuf,
      clips: assets.clips,
      colliders,
      input,
      camera,
      hud,
      stats,
      readback,
      audio,
      difficulty: currentDifficulty,
      onTalentsChanged: () => treeui.render(),
    });

  let run = makeRun();
  let treeui = createTreeUi({ talents: run.talents, loadout: run.loadout, app, sfx: audio.play });

  function resetWorld() {
    run.dispose();
    treeui.dispose();
    audio.stopAllLoops();
    stats.reset();
    readback.invalidate();
    sim.reset();
    renderer.resetTransient();
    hud.reset();
    run = makeRun();
    treeui = createTreeUi({ talents: run.talents, loadout: run.loadout, app, sfx: audio.play });
  }

  function startFresh(difficulty = currentDifficulty) {
    if (app.state === 'options') app.back();
    currentDifficulty = difficulty;
    resetWorld();
    app.to('playing');
  }

  let menuDifficulty: Difficulty = 'normal';
  const diffButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>('#difficulty-row button'),
  );
  for (const btn of diffButtons) {
    btn.classList.toggle('active', btn.dataset.diff === menuDifficulty);
    btn.addEventListener('click', () => {
      menuDifficulty = btn.dataset.diff as Difficulty;
      for (const b of diffButtons) b.classList.toggle('active', b === btn);
    });
  }

  app.onEnter('playing', () => input.clear());
  app.onEnter('tree', () => hud.spellbookFlare(false));

  const duckOf = (s: AppState): number => {
    if (s === 'playing') return AUDIO.duckLevel.playing;
    if (s === 'dead') return AUDIO.duckLevel.dead;
    if (s === 'menu' || ((s === 'options' || s === 'keymap') && app.openedFrom(s) === 'menu')) {
      return AUDIO.duckLevel.menu;
    }
    return AUDIO.duckLevel.frozen;
  };
  let prevAppState: AppState = 'menu';
  audio.setWorldDuck(duckOf('menu'));
  const onAppState = (s: AppState) => {
    audio.setWorldDuck(duckOf(s));
    if (s === 'menu') audio.music('menu');
    if (s === 'paused') audio.play('ui_pause');
    else if (s === 'playing' && prevAppState === 'paused') audio.play('ui_resume');
    if (s === 'tree') audio.play('ui_tree_open');
    else if (s === 'playing' && prevAppState === 'tree') audio.play('ui_tree_close');
    if (s === 'dead') {
      audio.music(null);
      audio.play('sting_gameover');
    }
    prevAppState = s;
  };
  const APP_STATES: AppState[] = ['menu', 'playing', 'tree', 'paused', 'dead', 'options', 'keymap'];
  for (const s of APP_STATES) app.onEnter(s, () => onAppState(s));

  document.addEventListener(
    'click',
    (e) => {
      const btn = (e.target as Element).closest?.('button');
      if (!btn || btn.disabled || btn.closest('#hud')) return;
      const draws = btn.id === 'start-btn' || btn.id === 'retry-btn';
      audio.play(draws ? 'ui_start' : 'ui_click');
    },
    true,
  );

  const BUTTON_CLICKS: [string, () => void][] = [
    ['start-btn', () => startFresh(menuDifficulty)],
    ['retry-btn', () => startFresh()],
    [
      'go-menu-btn',
      () => {
        resetWorld();
        app.to('menu');
      },
    ],
    ['resume-btn', () => app.to('playing')],
    ['restart-btn', () => startFresh()],
    [
      'quit-btn',
      () => {
        resetWorld();
        app.to('menu');
      },
    ],
    ['abilities-btn', () => app.to('tree')],
    ['menu-options-btn', () => app.to('options')],
    ['pause-options-btn', () => app.to('options')],
    ['menu-controls-btn', () => app.to('keymap')],
    ['pause-controls-btn', () => app.to('keymap')],
  ];
  for (const [id, handler] of BUTTON_CLICKS) el(id).addEventListener('click', handler);
  createKeymapUi({ close: () => app.back() });
  createTouchControls({
    input,
    canvas,
    onPause: () => {
      if (app.state === 'playing') app.to('paused');
      else if (app.state === 'paused') app.to('playing');
    },
  });

  const applySize = (w = canvas.clientWidth, h = canvas.clientHeight) => {
    const scale = canvasScale(settings, window.devicePixelRatio);
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    renderer.resize(canvas.width, canvas.height);
  };
  applySize();
  new ResizeObserver((entries) => {
    const box = entries[0].contentBoxSize[0];
    applySize(box.inlineSize, box.blockSize);
  }).observe(canvas);

  function applySettings(prev: GraphicsSettings) {
    sim.setParticleDensity(settings.particles);
    setEffectDensity(settings.particles);
    if (needsRebuild(prev, settings)) {
      if (prev.grassDensity !== settings.grassDensity) {
        scatter = scatterWorld(7, settings.grassDensity, assets.propFootprints);
      }
      renderer.rebuild();
      renderer.setPostOptions(liveRenderOptions(settings));
      applySize();
      run.remirror();
    } else {
      renderer.setPostOptions(liveRenderOptions(settings));
      if (needsResize(prev, settings)) applySize();
    }
    camera.setZoom(settings.zoom);
    renderer.setZoom(settings.zoom);
    audio.setVolumes(settings.volMaster, settings.volMusic, settings.volSfx);
    saveSettings(settings);
  }

  createOptionsUi({ settings, apply: applySettings, close: () => app.back() });

  loadProgress('', 1);
  overlay.classList.add('ready');
  menuReady = true;
  startBtn.disabled = !menuReady;

  let revealT = 0;
  const updateReveal = (dt: number) => {
    if (revealT > REVEAL.duration + 1) return;
    revealT += Math.min(dt, 1 / 30);
    const x = Math.min(1, revealT / REVEAL.duration);
    renderer.setReveal(1 - (1 - x) ** 3);
  };
  renderer.setReveal(0);

  function step(dt: number, enc: GPUCommandEncoder) {
    if (app.state === 'playing' || app.state === 'dead') {
      run.update(dt);
      sim.run(dt, enc);
      if (app.state === 'playing') readback.tick(enc, dt);
    } else if (
      app.state === 'menu' ||
      ((app.state === 'options' || app.state === 'keymap') && app.openedFrom(app.state) === 'menu')
    ) {
      run.idle(dt);
    }
  }

  function draw(dt: number, enc: GPUCommandEncoder) {
    renderer.setFireActive(sim.fireActive());
    renderer.setWaterActive(sim.waterActive());
    renderer.render(dt, run.focusX, run.focusZ, enc);
    if (app.state !== 'menu') vitals.render(dt, enc);
  }

  function runFrame(dt: number) {
    updateReveal(dt);
    const enc = root.device.createCommandEncoder();
    step(dt, enc);
    draw(dt, enc);
    root.device.queue.submit([enc.finish()]);
    readback.afterSubmit();
  }

  let last = performance.now();
  function frame(now: number) {
    if (stopped) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    try {
      runFrame(dt);
      if (!stopped) requestAnimationFrame(frame);
    } catch (err) {
      console.error(err);
      showGpuFailure('Graphics stopped', err);
    }
  }
  requestAnimationFrame(frame);
}

boot().catch((err) => {
  console.error(err);
  if (!nogpu.classList.contains('hidden')) return;
  overlay.classList.add('load-failed');
  loadingNote.textContent = `failed to load: ${err instanceof Error ? err.message : err}`;
});
