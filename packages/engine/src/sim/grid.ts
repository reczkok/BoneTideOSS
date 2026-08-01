import { d, std, type TgpuRoot } from 'typegpu';
import { createKernel } from '../core/kernel.ts';
import { MAX_ENEMIES, SEP_GRID } from '../config.ts';
import { Actor, type ActorBuffer, STATE } from '../core/schemas.ts';

const CELLS = SEP_GRID.cells;
const TOTAL = CELLS * CELLS;

export function createNeighborGrid(root: TgpuRoot, enemyBuf: ActorBuffer) {
  const enemies = enemyBuf.as('readonly');

  const countBuf = root.createBuffer(d.arrayOf(d.u32, TOTAL)).$usage('storage');
  /** The same cells as `counts`, viewed as atomics for the counting pass. */
  const countAtomic = root.createMutable(d.arrayOf(d.atomic(d.u32), TOTAL), countBuf.buffer);
  const counts = countBuf.as('mutable');
  const ranks = root.createMutable(d.arrayOf(d.u32, MAX_ENEMIES));
  const starts = root.createMutable(d.arrayOf(d.u32, TOTAL + 1));
  const indices = root.createMutable(d.arrayOf(d.u32, MAX_ENEMIES));

  const cellOf = (p: d.v2f) => {
    'use gpu';
    const cs = (SEP_GRID.half * 2) / CELLS;
    const cx = std.clamp(d.i32((p.x + SEP_GRID.half) / cs), 0, CELLS - 1);
    const cz = std.clamp(d.i32((p.y + SEP_GRID.half) / cs), 0, CELLS - 1);
    return d.vec2i(cx, cz);
  };

  const clearPipeline = createKernel(root, [TOTAL], (i: number) => {
    'use gpu';
    counts.$[i] = 0;
  });

  const inGrid = (e: d.InferGPU<typeof Actor>) => {
    'use gpu';
    return e.state === STATE.ALIVE || (e.state === STATE.DYING && e.animTime === 0);
  };

  const countPipeline = createKernel(root, [MAX_ENEMIES], (i: number) => {
    'use gpu';
    const e = enemies.$[i];
    if (!inGrid(e)) {
      return;
    }
    const c = cellOf(e.pos);
    ranks.$[i] = std.atomicAdd(countAtomic.$[c.y * CELLS + c.x], 1);
  });

  const prefixPipeline = createKernel(root, [1], () => {
    'use gpu';
    let acc = d.u32(0);
    for (const c of std.range(TOTAL)) {
      starts.$[c] = acc;
      acc += counts.$[c];
    }
    starts.$[TOTAL] = acc;
  });

  const scatterPipeline = createKernel(root, [MAX_ENEMIES], (i: number) => {
    'use gpu';
    const e = enemies.$[i];
    if (!inGrid(e)) {
      return;
    }
    const c = cellOf(e.pos);
    indices.$[starts.$[c.y * CELLS + c.x] + ranks.$[i]] = d.u32(i);
  });

  return {
    cellOf,
    starts,
    indices,
    run(enc: GPUCommandEncoder) {
      clearPipeline.run(enc);
      countPipeline.run(enc);
      prefixPipeline.run(enc);
      scatterPipeline.run(enc);
    },
  };
}

export type NeighborGrid = ReturnType<typeof createNeighborGrid>;
