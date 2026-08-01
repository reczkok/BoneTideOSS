import { d, std, type TgpuRoot, type WithBinding } from 'typegpu';
import { createKernel } from '../core/kernel.ts';
import { MAX_ENEMIES, TRAMPLE_CELLS, TRAMPLE_HALF } from '../config.ts';
import { type ActorBuffer, STATE, type TrampleBuffer } from '../core/schemas.ts';
import { simParams } from './bindings.ts';

const TRAMPLE_TOTAL = TRAMPLE_CELLS * TRAMPLE_CELLS;

export function createTrampleField(
  root: TgpuRoot,
  gpu: WithBinding,
  enemyBuf: ActorBuffer,
): { trampleBuf: TrampleBuffer; run(enc: GPUCommandEncoder): void; reset(): void } {
  const enemies = enemyBuf.as('readonly');

  const trampleBuf = root.createBuffer(d.arrayOf(d.i32, TRAMPLE_TOTAL * 2)).$usage('storage');
  const trampleAtomic = root.createMutable(
    d.arrayOf(d.atomic(d.i32), TRAMPLE_TOTAL * 2),
    trampleBuf.buffer,
  );
  const tramplePlain = trampleBuf.as('mutable');

  const decay = createKernel(gpu, [TRAMPLE_TOTAL * 2], (i: number) => {
    'use gpu';
    const v = tramplePlain.$[i];
    if (v !== 0) {
      const decayed = d.f32(v) * std.exp(-5.5 * simParams.$.dt);
      tramplePlain.$[i] = d.i32(decayed);
    }
  });

  const splat = createKernel(gpu, [MAX_ENEMIES], (i: number) => {
    'use gpu';
    const e = enemies.$[i];
    if (e.state !== STATE.ALIVE) {
      return;
    }
    const cellSize = (TRAMPLE_HALF * 2) / TRAMPLE_CELLS;
    const gx = (e.pos.x + TRAMPLE_HALF) / cellSize;
    const gz = (e.pos.y + TRAMPLE_HALF) / cellSize;
    const reach = (e.radius + 0.65) / cellSize;
    for (const dz of std.range(-2, 3)) {
      for (const dx of std.range(-2, 3)) {
        const cx = d.i32(gx) + d.i32(dx);
        const cz = d.i32(gz) + d.i32(dz);
        if (cx >= 0 && cx < TRAMPLE_CELLS && cz >= 0 && cz < TRAMPLE_CELLS) {
          const ox = d.f32(cx) + 0.5 - gx;
          const oz = d.f32(cz) + 0.5 - gz;
          const dist = std.sqrt(ox * ox + oz * oz);
          if (dist < reach && dist > 1e-4) {
            const strength = (1 - dist / reach) * 900;
            const idx = (cz * TRAMPLE_CELLS + cx) * 2;
            std.atomicAdd(trampleAtomic.$[idx], d.i32((ox / dist) * strength));
            std.atomicAdd(trampleAtomic.$[idx + 1], d.i32((oz / dist) * strength));
          }
        }
      }
    }
  });

  return {
    trampleBuf,
    run(enc: GPUCommandEncoder) {
      decay.run(enc);
      splat.run(enc);
    },
    reset() {
      trampleBuf.write(Array.from({ length: TRAMPLE_TOTAL * 2 }, () => 0));
    },
  };
}
