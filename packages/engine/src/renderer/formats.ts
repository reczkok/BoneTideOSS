import type { TgpuRoot, TgpuTextureView } from 'typegpu';

/** What `texture.createView('render')` returns; typegpu does not export the interface. */
interface RenderView {
  readonly resourceType: 'texture-view';
  readonly descriptor: unknown;
}

export const SCENE_FORMAT: GPUTextureFormat = 'rgba16float';
export const DEPTH_FORMAT: GPUTextureFormat = 'depth24plus';
export const OFFSET_FORMAT: GPUTextureFormat = 'rg16float';

export const SKY = [0.62, 0.73, 0.66] as const;

export const PREMUL_BLEND: GPUBlendState = {
  color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
};

export const SHADOW_DEPTH_STENCIL: GPUDepthStencilState = {
  format: DEPTH_FORMAT,
  depthWriteEnabled: true,
  depthCompare: 'less',
  depthBias: 2,
  depthBiasSlopeScale: 2,
};

/**
 * The raw `GPUTextureView` behind a render view, for passes the renderer
 * opens itself with `encoder.beginRenderPass` (several pipelines share them).
 * `root.unwrap` handles render views at runtime but only types sampled ones.
 */
export const rawView = (root: TgpuRoot, view: RenderView) =>
  root.unwrap(view as unknown as TgpuTextureView);
