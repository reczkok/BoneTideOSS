import type { TgpuRoot, TgpuUniform } from 'typegpu';
import type { GameAssets } from '../assets/assets.ts';
import type { CanvasLike } from '../core/canvas.ts';
import type {
  ActorBuffer,
  CameraData,
  ChainBuffer,
  FxData,
  ParticleBuffer,
  TelegraphRecord,
  TrampleBuffer,
  VolleyBuffer,
} from '../core/schemas.ts';
import type { WorldScatter } from '../core/world.ts';
import type { FieldTextures } from '../sim/field.ts';
import { createBoltPass } from './bolts.ts';
import { createCharacterPass } from './characters.ts';
import { createEnv, type LightingValues, type LightSpec, type SteadyLightSpec } from './env.ts';
import { createFireflyPass } from './fireflies.ts';
import { SCENE_FORMAT } from './formats.ts';
import { createGroundPass } from './ground.ts';
import { createParticlePass, type ParticleSpec } from './particles.ts';
import { createPostPass } from './post.ts';
import type { BakedRenderQuality, LiveRenderOptions } from './quality.ts';
import { createPropPass, type PropInstanceSpec } from './props.ts';
import { createSpectralPass, type SpectralInstanceSpec } from './spectral.ts';
import { makeTargets } from './targets.ts';

export interface SharedBuffers {
  enemyBuf: ActorBuffer;
  playerBuf: ActorBuffer;
  particleBuf: ParticleBuffer;
  trampleBuf: TrampleBuffer;
  fieldTex: FieldTextures;
  chainBuf: ChainBuffer;
  volleyBuf: VolleyBuffer;
}

export interface Renderer {
  camera: TgpuUniform<typeof CameraData>;
  fx: TgpuUniform<typeof FxData>;
  setLighting(v: LightingValues): void;
  light(spec: LightSpec): void;
  steadyLight(key: string, spec: SteadyLightSpec | null): void;
  setScreenFx(flash: number, hurt: number): void;
  setPostOptions(options: LiveRenderOptions): void;
  setReveal(v: number): void;
  setHazeActive(active: boolean): void;
  updateSpectral(
    blades: readonly SpectralInstanceSpec[],
    arrows: readonly SpectralInstanceSpec[],
  ): void;
  updateEnemyArrows(instances: readonly SpectralInstanceSpec[]): void;
  setToxicWake(on: boolean): void;
  setTelegraphs(entries: readonly TelegraphRecord[] | null, count: number): void;
  emit(specs: readonly ParticleSpec[]): void;
  updateMeteor(x: number, y: number, z: number, spin: number): void;
  updateSpikeRocks(instances: readonly PropInstanceSpec[]): void;
  updateBoulders(instances: readonly PropInstanceSpec[]): void;
  setFireActive(active: boolean): void;
  setWaterActive(active: boolean): void;
  setZoom(zoom: number): void;
  setBoltsActive(active: boolean): void;
  setEnemyCounts(counts: readonly number[]): void;
  setGroundDisplaced(active: boolean): void;
  setViewZRange(minZ: number, maxZ: number): void;
  render(dt: number, focusX: number, focusZ: number, enc: GPUCommandEncoder): void;
  resize(width: number, height: number): void;
  resetTransient(): void;
  destroy(): void;
}

export function createRenderer(
  root: TgpuRoot,
  context: GPUCanvasContext,
  canvasFormat: GPUTextureFormat,
  canvas: CanvasLike,
  assets: GameAssets,
  scatter: WorldScatter,
  buffers: SharedBuffers,
  quality: BakedRenderQuality,
  postOptions: LiveRenderOptions,
): Renderer {
  const env = createEnv(root, SCENE_FORMAT, quality, buffers.fieldTex);
  const characters = createCharacterPass(root, env, assets, buffers.enemyBuf, buffers.playerBuf);
  const props = createPropPass(root, env, assets, scatter, buffers.trampleBuf);
  const ground = createGroundPass(root, env, buffers.volleyBuf);
  const bolts = createBoltPass(env, buffers.chainBuf);
  const spectral = createSpectralPass(root, env, assets);
  const fireflies = createFireflyPass(root, env, buffers.chainBuf);
  const particles = createParticlePass(root, env, buffers.particleBuf);
  const post = createPostPass(root, env, canvasFormat, context, postOptions);

  let targets = makeTargets(
    root,
    canvasFormat,
    canvas.width || 1,
    canvas.height || 1,
    quality.msaa,
  );
  post.bind(targets);

  let fireActive = false;
  let waterActive = false;
  let boltsActive = false;
  let groundDisplaced = false;

  const clearDepth = (
    view: GPUTextureView,
    store: GPUStoreOp,
  ): GPURenderPassDepthStencilAttachment => ({
    view,
    depthLoadOp: 'clear',
    depthStoreOp: store,
    depthClearValue: 1,
  });

  return {
    camera: env.camera,
    fx: env.fx,
    setLighting: env.setLighting,
    light: env.addLight,
    steadyLight: env.setSteadyLight,
    setScreenFx: post.setFx,
    setPostOptions: post.setOptions,
    setReveal: (v) => env.reveal.write(v),
    setHazeActive: post.setHazeActive,
    updateSpectral: spectral.update,
    updateEnemyArrows: spectral.updateEnemyArrows,
    setToxicWake(on) {
      spectral.setToxicWake(on);
      ground.setToxicWake(on);
    },
    setTelegraphs: env.setTelegraphs,
    emit: particles.emit,
    updateMeteor: props.updateMeteor,
    updateSpikeRocks: props.updateSpikeRocks,
    updateBoulders: props.updateBoulders,
    resize(width, height) {
      targets.destroy();
      targets = makeTargets(root, canvasFormat, width, height, quality.msaa);
      post.bind(targets);
    },
    resetTransient() {
      boltsActive = false;
      groundDisplaced = false;
      characters.resetLiveCounts();
      particles.reset();
      env.reset();
      spectral.update([], []);
      spectral.updateEnemyArrows([]);
      props.updateMeteor(0, -100, 0, 0);
      props.updateSpikeRocks([]);
      props.updateBoulders([]);
      post.setFx(0, 0);
      post.setHazeActive(false);
    },
    setFireActive(active) {
      if (active !== fireActive) env.setFireOn(active);
      fireActive = active;
    },
    setWaterActive(active) {
      if (active !== waterActive) env.setWaterOn(active);
      waterActive = active;
    },
    setZoom: env.setShadowZoom,
    setBoltsActive(active) {
      boltsActive = active;
    },
    setEnemyCounts: characters.setLiveCounts,
    setGroundDisplaced(active) {
      groundDisplaced = active;
    },
    setViewZRange: props.setViewZRange,
    render(dt, focusX, focusZ, encoder) {
      // One compute pass for every per-frame prep, one shadow pass, one scene
      // pass, then post; nothing here submits, the caller owns the encoder.
      const prep = encoder.beginComputePass();
      env.beginFrame(dt, focusX, focusZ, prep);
      fireflies.update(dt, prep);
      characters.update(prep);
      props.update(prep);
      particles.update(prep, dt);
      prep.end();

      const shadowPass = encoder.beginRenderPass({
        colorAttachments: [],
        depthStencilAttachment: clearDepth(env.shadowTarget, 'store'),
      });
      characters.drawShadow(shadowPass);
      props.drawShadow(shadowPass);
      shadowPass.end();

      const scenePass = encoder.beginRenderPass({
        colorAttachments: [
          targets.msaaViewRaw
            ? {
                view: targets.msaaViewRaw,
                resolveTarget: targets.sceneViewRaw,
                loadOp: 'clear',
                storeOp: 'discard',
                clearValue: env.clearColor,
              }
            : {
                view: targets.sceneViewRaw,
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: env.clearColor,
              },
        ],
        depthStencilAttachment: clearDepth(targets.depthViewRaw, 'discard'),
      });
      characters.draw(scenePass);
      props.draw(scenePass);
      ground.draw(scenePass, groundDisplaced);
      spectral.draw(scenePass);
      if (boltsActive) bolts.draw(scenePass);
      fireflies.draw(scenePass);
      particles.draw(scenePass);
      scenePass.end();

      post.draw(encoder, targets);
    },
    destroy() {
      targets.destroy();
      env.destroy();
      ground.destroy();
    },
  };
}
