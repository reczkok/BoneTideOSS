/**
 * Fixed-size compute kernels: a regular compute pipeline whose thread count
 * is baked into the shader as a bounds check, recorded into a caller-owned
 * command encoder or compute pass (renderer.render opens ONE compute pass
 * for the whole prepass and the modules dispatch into it; a pass per
 * dispatch pays begin/end calls and a Metal encoder switch, ~10-15 times per
 * frame).
 *
 * Deliberately NOT a guarded pipeline (`createGuardedComputePipeline`): a
 * guarded pipeline ships its thread count through a uniform that is
 * rewritten from the CPU, and since TypeGPU 0.12 it can only submit on its
 * own; it cannot be recorded into a shared pass. Every kernel in the engine
 * runs on a compile-time-constant count, so baking the bound costs nothing
 * and the dispatch is a plain `dispatchWorkgroups`.
 */
import tgpu, { d, type TgpuComputeFn, type TgpuComputePipeline, type WithBinding } from 'typegpu';

export type KernelTarget = GPUCommandEncoder | GPUComputePassEncoder;

export interface Kernel {
  readonly pipeline: TgpuComputePipeline;
  /** Records one dispatch covering every thread into `target`. */
  run(target: KernelTarget): void;
}

const WG_1D = 256;
const WG_2D = 16;

export function createKernel(
  root: WithBinding,
  size: readonly [number],
  body: (x: number) => void,
): Kernel;
export function createKernel(
  root: WithBinding,
  size: readonly [number, number],
  body: (x: number, y: number) => void,
): Kernel;
export function createKernel(
  root: WithBinding,
  size: readonly [number] | readonly [number, number],
  body: (...args: number[]) => void,
): Kernel {
  const [sx, sy = 1] = size;
  if (!Number.isInteger(sx) || sx < 1 || !Number.isInteger(sy) || sy < 1) {
    throw new Error(`kernel size must be positive integers, got [${size.join(', ')}]`);
  }

  let compute: TgpuComputeFn<{ gid: d.BuiltinGlobalInvocationId }>;
  let workgroups: [number, number];
  if (size.length === 1) {
    const kernelBody = tgpu.fn([d.u32])(body as (x: number) => void);
    compute = tgpu.computeFn({
      workgroupSize: [WG_1D],
      in: { gid: d.builtin.globalInvocationId },
    })((input) => {
      'use gpu';
      if (input.gid.x >= sx) {
        return;
      }
      kernelBody(input.gid.x);
    });
    workgroups = [Math.ceil(sx / WG_1D), 1];
  } else {
    const kernelBody = tgpu.fn([d.u32, d.u32])(body as (x: number, y: number) => void);
    compute = tgpu.computeFn({
      workgroupSize: [WG_2D, WG_2D],
      in: { gid: d.builtin.globalInvocationId },
    })((input) => {
      'use gpu';
      if (input.gid.x >= sx || input.gid.y >= sy) {
        return;
      }
      kernelBody(input.gid.x, input.gid.y);
    });
    workgroups = [Math.ceil(sx / WG_2D), Math.ceil(sy / WG_2D)];
  }

  const pipeline = root.createComputePipeline({ compute });
  return {
    pipeline,
    run(target) {
      // `with` accepts both a command encoder and an open compute pass and
      // detects which at runtime; the cast only picks the overload.
      pipeline.with(target as GPUCommandEncoder).dispatchWorkgroups(workgroups[0], workgroups[1]);
    },
  };
}
