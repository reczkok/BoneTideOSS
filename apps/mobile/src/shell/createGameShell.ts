import { PixelRatio } from 'react-native';
import { d, type TgpuRoot } from 'typegpu';
import { loadGameAssets } from '@bonetide/engine/assets/assets.ts';
import { MAX_ENEMIES, MAX_PARTICLES, REVEAL } from '@bonetide/engine/config.ts';
import { Actor, Particle } from '@bonetide/engine/core/schemas.ts';
import type { CanvasLike } from '@bonetide/engine/core/canvas.ts';
import { rockColliders, scatterWorld } from '@bonetide/engine/core/world.ts';
import { createApp, type AppState } from '@bonetide/engine/game/app.ts';
import { createCamera } from '@bonetide/engine/game/camera.ts';
import { setEffectDensity } from '@bonetide/engine/game/effects/pool.ts';
import { createRun } from '@bonetide/engine/game/game.ts';
import type { Hud } from '@bonetide/engine/game/hud.ts';
import { createInput, type Action } from '@bonetide/engine/game/input.ts';
import { ActorReadback } from '@bonetide/engine/game/readback.ts';
import { createRunStats } from '@bonetide/engine/game/stats.ts';
import { createRendererHandle } from '@bonetide/engine/renderer/handle.ts';
import { bakedRenderQuality, liveRenderOptions } from '@bonetide/engine/renderer/quality.ts';
import { createRenderer } from '@bonetide/engine/renderer/renderer.ts';
import { createSim } from '@bonetide/engine/sim/sim.ts';
import { createAudioEngine } from '../audio/engine.ts';
import { canvasScale, loadSettings } from '../settings.ts';

type RNCanvasContext = GPUCanvasContext & { present?: () => void };

export interface GameShellHooks {
  hud: Hud;
  onProgress(message: string, fraction: number): void;
  onState(state: AppState): void;
  onFatal(title: string, detail: string): void;
}

export interface GameShell {
  state(): AppState;
  to(state: AppState): void;
  back(): void;
  startRun(): void;
  quitToMenu(): void;
  press(action: Action): void;
  move(x: number, z: number): void;
  resize(width: number, height: number): void;
  points(): number;
  stop(): void;
}

export async function createGameShell(
  root: TgpuRoot,
  context: RNCanvasContext,
  canvas: CanvasLike,
  hooks: GameShellHooks,
): Promise<GameShell> {
  let stopped = false;
  const fatal = (title: string, reason: unknown) => {
    if (stopped) return;
    stopped = true;
    hooks.onFatal(title, reason instanceof Error ? reason.message : String(reason));
  };
  void root.device.lost.then((info) => fatal('Graphics device lost', info.message || info.reason));
  root.device.addEventListener('uncapturederror', (event) => {
    fatal('WebGPU validation error', event.error.message);
  });

  const assets = await loadGameAssets(root, (message, fraction) =>
    hooks.onProgress(message, fraction * 0.96),
  );
  if (stopped) throw new Error('stopped during asset load');
  hooks.onProgress('sharpening swords…', 0.98);

  const settings = loadSettings();
  setEffectDensity(settings.particles);

  const enemyBuf = root.createBuffer(d.arrayOf(Actor, MAX_ENEMIES)).$usage('storage');
  const playerBuf = root.createBuffer(d.arrayOf(Actor, 1)).$usage('storage');
  const particleBuf = root.createBuffer(d.arrayOf(Particle, MAX_PARTICLES)).$usage('storage');

  const scatter = scatterWorld(7, settings.grassDensity, assets.propFootprints);
  const colliders = rockColliders(scatter, assets.propFootprints);
  const sim = createSim(root, enemyBuf, particleBuf, assets.clips, colliders, settings.particles);
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
  const input = createInput(() => app.state === 'playing');
  const stats = createRunStats();
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
      hud: hooks.hud,
      stats,
      readback,
      audio,
      difficulty: 'normal',
    });

  let run = makeRun();
  app.subscribe(() => hooks.onState(app.state));
  app.onEnter('playing', () => input.clear());

  function resetWorld() {
    run.dispose();
    stats.reset();
    readback.invalidate();
    sim.reset();
    renderer.resetTransient();
    hooks.hud.reset();
    run = makeRun();
  }

  const applySize = (width: number, height: number) => {
    const scale = canvasScale(settings, PixelRatio.get());
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    renderer.resize(canvas.width, canvas.height);
  };
  applySize(canvas.clientWidth || 1, canvas.clientHeight || 1);

  let revealT = 0;
  renderer.setReveal(0);

  function runFrame(dt: number) {
    if (revealT <= REVEAL.duration + 1) {
      revealT += Math.min(dt, 1 / 30);
      const x = Math.min(1, revealT / REVEAL.duration);
      renderer.setReveal(1 - (1 - x) ** 3);
    }
    const encoder = root.device.createCommandEncoder();
    if (app.state === 'playing' || app.state === 'dead') {
      run.update(dt);
      sim.run(dt, encoder);
      if (app.state === 'playing') readback.tick(encoder, dt);
    } else if (app.state === 'menu') {
      run.idle(dt);
    }
    renderer.setFireActive(sim.fireActive());
    renderer.setWaterActive(sim.waterActive());
    renderer.render(dt, run.focusX, run.focusZ, encoder);
    root.device.queue.submit([encoder.finish()]);
    context.present?.();
    readback.afterSubmit();
  }

  let last = 0;
  let raf = 0;
  const frame = (now: number) => {
    if (stopped) return;
    const dt = last === 0 ? 1 / 60 : Math.min(0.05, (now - last) / 1000);
    last = now;
    try {
      runFrame(dt);
    } catch (err) {
      fatal('Graphics stopped', err);
      return;
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  hooks.onProgress('', 1);
  hooks.onState(app.state);

  return {
    state: () => app.state,
    to: (state) => app.to(state),
    back: () => app.back(),
    startRun() {
      resetWorld();
      app.to('playing');
    },
    quitToMenu() {
      resetWorld();
      app.to('menu');
    },
    press: (action) => input.queue(action),
    move: (x, z) => input.setVirtualMove(x, z),
    resize: applySize,
    points: () => run.talents.points,
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
    },
  };
}
