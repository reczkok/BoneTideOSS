import { d, std, type TgpuRoot } from 'typegpu';
import { createKernel } from '../core/kernel.ts';
import { randf } from '@typegpu/noise';
import { FIELD, FIRE, WATER } from '../config.ts';
import type { FieldBuffer } from '../core/schemas.ts';

if (WATER.cells !== FIRE.cells || WATER.half !== FIRE.half) {
  throw new Error('WATER grid must stay cell-identical to FIRE (they share the field buffer)');
}

export const FP = 1024;
export const INV_FP = 1 / FP;
export const FIELD_CELLS = FIRE.cells;
export const FIELD_HALF = FIRE.half;
export const FIELD_CELL = (FIELD_HALF * 2) / FIELD_CELLS;
export const FIELD_TOTAL = FIELD_CELLS * FIELD_CELLS;

export function paintCone(
  px: number,
  pz: number,
  dx: number,
  dz: number,
  range: number,
  cosHalf: number,
  edgeFalloff: number,
  write: (base: number, falloff: number, nx: number, nz: number) => void,
): void {
  const cMin = Math.max(0, Math.floor((px - range + FIELD_HALF) / FIELD_CELL));
  const cMax = Math.min(FIELD_CELLS - 1, Math.ceil((px + range + FIELD_HALF) / FIELD_CELL));
  const zMin = Math.max(0, Math.floor((pz - range + FIELD_HALF) / FIELD_CELL));
  const zMax = Math.min(FIELD_CELLS - 1, Math.ceil((pz + range + FIELD_HALF) / FIELD_CELL));
  for (let cz = zMin; cz <= zMax; cz++) {
    for (let cx = cMin; cx <= cMax; cx++) {
      const wx = (cx + 0.5) * FIELD_CELL - FIELD_HALF;
      const wz = (cz + 0.5) * FIELD_CELL - FIELD_HALF;
      const rx = wx - px;
      const rz = wz - pz;
      const dist = Math.hypot(rx, rz);
      if (dist > range || dist < 1e-3) continue;
      const nx = rx / dist;
      const nz = rz / dist;
      if (nx * dx + nz * dz < cosHalf) continue;
      write((cz * FIELD_CELLS + cx) * FIELD.STRIDE, 1 - (dist / range) * edgeFalloff, nx, nz);
    }
  }
}

export function paintDisc(
  px: number,
  pz: number,
  range: number,
  edgeFalloff: number,
  write: (base: number, falloff: number) => void,
): void {
  const cMin = Math.max(0, Math.floor((px - range + FIELD_HALF) / FIELD_CELL));
  const cMax = Math.min(FIELD_CELLS - 1, Math.ceil((px + range + FIELD_HALF) / FIELD_CELL));
  const zMin = Math.max(0, Math.floor((pz - range + FIELD_HALF) / FIELD_CELL));
  const zMax = Math.min(FIELD_CELLS - 1, Math.ceil((pz + range + FIELD_HALF) / FIELD_CELL));
  for (let cz = zMin; cz <= zMax; cz++) {
    for (let cx = cMin; cx <= cMax; cx++) {
      const wx = (cx + 0.5) * FIELD_CELL - FIELD_HALF;
      const wz = (cz + 0.5) * FIELD_CELL - FIELD_HALF;
      const dist = Math.hypot(wx - px, wz - pz);
      if (dist > range) continue;
      write((cz * FIELD_CELLS + cx) * FIELD.STRIDE, 1 - (dist / range) * edgeFalloff);
    }
  }
}

export function makeFixedStepRunner(
  tickInterval: number,
  idleTickInterval: number,
  maxSteps: number,
  tick: (enc: GPUCommandEncoder) => void,
): {
  run(dt: number, active: boolean, enc: GPUCommandEncoder): number;
  reset(): void;
} {
  let acc = 0;
  return {
    run(dt, active, enc) {
      acc += dt;
      const interval = active ? tickInterval : idleTickInterval;
      let steps = 0;
      while (acc >= interval && steps < maxSteps) {
        acc -= interval;
        steps++;
        tick(enc);
      }
      return steps;
    },
    reset() {
      acc = 0;
    },
  };
}

/** Integer field cell containing world point `p`; check with `inField` before loading. */
export const fieldCoord = (p: d.v2f) => {
  'use gpu';
  return d.vec2i((p + FIELD_HALF) * (1 / FIELD_CELL));
};

export const inField = (c: d.v2i) => {
  'use gpu';
  return c.x >= 0 && c.x < FIELD_CELLS && c.y >= 0 && c.y < FIELD_CELLS;
};

/** Normalized field-texture uv of world point `p`. */
export const fieldUv = (p: d.v2f) => {
  'use gpu';
  return (p + FIELD_HALF) * (1 / (FIELD_HALF * 2));
};

export const seedFieldCell = (cell: number, time: number) => {
  'use gpu';
  randf.seed2(
    d.vec2f(
      std.fract(d.f32(cell) * 0.02931 + time * 0.517),
      std.fract(time * 0.911 + d.f32(cell) * 0.0071),
    ),
  );
};

export type FieldTextures = ReturnType<typeof createFieldTextures>;

export function createFieldTextures(root: TgpuRoot, fieldBuf: FieldBuffer) {
  const texA = root
    .createTexture({ size: [FIELD_CELLS, FIELD_CELLS], format: 'rgba16float' })
    .$usage('sampled', 'storage');
  const texB = root
    .createTexture({ size: [FIELD_CELLS, FIELD_CELLS], format: 'rgba16float' })
    .$usage('sampled', 'storage');
  const storageA = texA.createView(d.textureStorage2d('rgba16float', 'write-only'));
  const storageB = texB.createView(d.textureStorage2d('rgba16float', 'write-only'));
  const cells = root.createReadonly(d.arrayOf(d.i32, FIELD_TOTAL * FIELD.STRIDE), fieldBuf.buffer);

  const blit = createKernel(root, [FIELD_CELLS, FIELD_CELLS], (x: number, y: number) => {
    'use gpu';
    const idx = (d.i32(y) * FIELD_CELLS + d.i32(x)) * FIELD.STRIDE;
    const texel = d.vec2u(d.u32(x), d.u32(y));
    const a = d.vec4f(
      d.f32(cells.$[idx + FIELD.FUEL]),
      d.f32(cells.$[idx + FIELD.HEAT]),
      d.f32(cells.$[idx + FIELD.WATER_H]),
      0,
    );
    std.textureStore(storageA.$, texel, a * INV_FP);
    const b = d.vec4f(
      d.f32(cells.$[idx + FIELD.WATER_VX]),
      d.f32(cells.$[idx + FIELD.WATER_VZ]),
      d.f32(cells.$[idx + FIELD.STEAM]),
      0,
    );
    std.textureStore(storageB.$, texel, b * INV_FP);
  });

  return {
    sampledA: texA.createView(d.texture2d(d.f32)),
    sampledB: texB.createView(d.texture2d(d.f32)),
    run(enc: GPUCommandEncoder) {
      blit.run(enc);
    },
  };
}
