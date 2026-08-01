import { d, type TgpuRoot } from 'typegpu';
import { DEPTH_FORMAT, OFFSET_FORMAT, rawView, SCENE_FORMAT } from './formats.ts';

/**
 * Every surface-sized texture, created and destroyed together on resize.
 * `*View` are render attachments, `*Sampled` the matching shader views, and
 * `*Raw` the unwrapped attachments for the shared scene passes.
 */
export function makeTargets(
  root: TgpuRoot,
  canvasFormat: GPUTextureFormat,
  w: number,
  h: number,
  msaa: 1 | 4,
) {
  const width = Math.max(1, w);
  const height = Math.max(1, h);
  const full: [number, number] = [width, height];
  const half: [number, number] = [Math.max(1, width >> 1), Math.max(1, height >> 1)];
  const format = SCENE_FORMAT;

  const msaaTex =
    msaa > 1
      ? root.createTexture({ size: full, format, sampleCount: msaa }).$usage('render')
      : null;
  const depthTex = root
    .createTexture({ size: full, format: DEPTH_FORMAT, sampleCount: msaa })
    .$usage('render');
  const sceneTex = root.createTexture({ size: full, format }).$usage('render', 'sampled');
  const bloomATex = root.createTexture({ size: half, format }).$usage('render', 'sampled');
  const bloomBTex = root.createTexture({ size: half, format }).$usage('render', 'sampled');
  const raysTex = root.createTexture({ size: half, format }).$usage('render', 'sampled');
  const hazeTex = root
    .createTexture({ size: half, format: OFFSET_FORMAT })
    .$usage('render', 'sampled');
  const postTex = root
    .createTexture({ size: full, format: canvasFormat })
    .$usage('render', 'sampled');
  const textures = [msaaTex, depthTex, sceneTex, bloomATex, bloomBTex, raysTex, hazeTex, postTex];

  const sampled = d.texture2d(d.f32);
  const msaaView = msaaTex?.createView('render') ?? null;
  const sceneView = sceneTex.createView('render');
  const raysView = raysTex.createView('render');
  const hazeView = hazeTex.createView('render');

  return {
    width,
    height,
    msaaViewRaw: msaaView ? rawView(root, msaaView) : null,
    depthViewRaw: rawView(root, depthTex.createView('render')),
    sceneViewRaw: rawView(root, sceneView),
    sceneSampled: sceneTex.createView(sampled),
    bloomAView: bloomATex.createView('render'),
    bloomASampled: bloomATex.createView(sampled),
    bloomBView: bloomBTex.createView('render'),
    bloomBSampled: bloomBTex.createView(sampled),
    raysView,
    raysViewRaw: rawView(root, raysView),
    raysSampled: raysTex.createView(sampled),
    hazeView,
    hazeViewRaw: rawView(root, hazeView),
    hazeSampled: hazeTex.createView(sampled),
    postView: postTex.createView('render'),
    postSampled: postTex.createView(sampled),
    destroy() {
      for (const tex of textures) tex?.destroy();
    },
  };
}

export type FrameTargets = ReturnType<typeof makeTargets>;
