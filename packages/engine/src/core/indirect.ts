import { d, type TgpuRoot } from 'typegpu';

/** One `drawIndexedIndirect` argument block: indexCount, instanceCount, firstIndex, baseVertex, firstInstance. */
const STRIDE = 5;

export interface IndirectBatch {
  indexCount: number;
  instanceCount: number;
}

/**
 * A packed array of indexed-indirect draw arguments, one block per batch.
 * Instance counts are patched on the CPU and flushed once per frame, so
 * batches that are empty this frame cost nothing on the GPU.
 */
export function createIndirectArgs(root: TgpuRoot, batches: readonly IndirectBatch[]) {
  const data = new Uint32Array(batches.length * STRIDE);
  batches.forEach((b, i) => {
    data[i * STRIDE] = b.indexCount;
    data[i * STRIDE + 1] = b.instanceCount;
  });
  const args = root.createBuffer(d.arrayOf(d.u32, data.length)).$usage('indirect');
  args.write(data);
  let dirty = false;

  return {
    buffer: args.buffer,
    offsetOf: (batch: number) => batch * STRIDE * 4,
    setInstanceCount(batch: number, count: number) {
      if (data[batch * STRIDE + 1] === count) return;
      data[batch * STRIDE + 1] = count;
      dirty = true;
    },
    flush() {
      if (!dirty) return;
      dirty = false;
      root.device.queue.writeBuffer(args.buffer, 0, data);
    },
  };
}

export type IndirectArgs = ReturnType<typeof createIndirectArgs>;
