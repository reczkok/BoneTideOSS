import { d, std, type WithBinding } from 'typegpu';
import { createKernel } from '../core/kernel.ts';
import { perlin2d, randf } from '@typegpu/noise';
import { FIELD, FIRE, WATER } from '../config.ts';
import type { FieldBuffer } from '../core/schemas.ts';
import { simParams } from './bindings.ts';
import type { GpuEmitters } from './emitters.ts';
import {
  FIELD_CELL,
  FIELD_TOTAL,
  FP,
  INV_FP,
  makeFixedStepRunner,
  paintCone,
  paintDisc,
  seedFieldCell,
} from './field.ts';

const WIND_LEN = Math.hypot(FIRE.windX, FIRE.windZ) || 1;
const WIND_X = FIRE.windX / WIND_LEN;
const WIND_Z = FIRE.windZ / WIND_LEN;

export const pristineFieldCells = () =>
  Array.from({ length: FIELD_TOTAL * FIELD.STRIDE }, (_, i) =>
    i % FIELD.STRIDE === FIELD.FUEL ? Math.round(FIRE.fuelInit * FP) : 0,
  );

export function createFireField(
  gpu: WithBinding,
  emitters: GpuEmitters,
  fieldBuf: FieldBuffer,
): {
  ignite(px: number, pz: number, dx: number, dz: number): void;
  igniteAt(px: number, pz: number, r: number, heatFrac: number): void;
  run(dt: number, active: boolean, enc: GPUCommandEncoder): boolean;
  reset(): void;
} {
  const cells = fieldBuf.as('mutable');

  const overheat = (base: number) => {
    'use gpu';
    return std.max(d.f32(cells.$[base + FIELD.HEAT]) * INV_FP - FIRE.spreadThreshold, 0);
  };

  const step = createKernel(gpu, [FIELD_TOTAL], (i: number) => {
    'use gpu';
    const cell = d.u32(i);
    const cx = cell % FIRE.cells;
    const cz = d.u32(cell / FIRE.cells);
    const idx = d.i32(cell) * FIELD.STRIDE;
    const fuel = d.f32(cells.$[idx + FIELD.FUEL]) * INV_FP;
    const heat = d.f32(cells.$[idx + FIELD.HEAT]) * INV_FP;

    let spread = d.f32(0);
    if (cx > 0) {
      spread += overheat(idx - FIELD.STRIDE) * (1 + FIRE.windBias * WIND_X);
    }
    if (cx < FIRE.cells - 1) {
      spread += overheat(idx + FIELD.STRIDE) * (1 - FIRE.windBias * WIND_X);
    }
    if (cz > 0) {
      spread += overheat(idx - FIRE.cells * FIELD.STRIDE) * (1 + FIRE.windBias * WIND_Z);
    }
    if (cz < FIRE.cells - 1) {
      spread += overheat(idx + FIRE.cells * FIELD.STRIDE) * (1 - FIRE.windBias * WIND_Z);
    }

    const wp = d.vec2f(d.f32(cx), d.f32(cz)) * FIELD_CELL - FIRE.half;
    const flam = std.max(
      0.12,
      0.55 + perlin2d.sample(wp * FIRE.flamScale + d.vec2f(43.1, 17.9)) * 0.9,
    );

    randf.seed2(
      d.vec2f(
        std.fract(d.f32(cell) * 0.01371 + simParams.$.time * 0.719),
        std.fract(simParams.$.time * 0.373),
      ),
    );
    const eager = 0.7 + randf.sample() * 0.6;

    let newHeat = heat * FIRE.decayRate;
    if (fuel > 0.03) {
      newHeat += spread * (FIRE.spreadRate * eager * flam) * std.min(fuel * 3, 1);
    } else {
      newHeat = heat * 0.72;
    }
    newHeat = std.min(newHeat, 1.6);
    const waterH = d.f32(cells.$[idx + FIELD.WATER_H]) * INV_FP;
    const quench = std.smoothstep(WATER.quenchMinDepth, WATER.extinguishThreshold, waterH);
    const removed = newHeat * std.min(quench * (WATER.quenchRate * FIRE.tickInterval), 1);
    newHeat -= removed;
    if (newHeat < 0.012) {
      newHeat = 0;
    }

    let steam = d.f32(cells.$[idx + FIELD.STEAM]) * INV_FP;
    steam += removed * WATER.steamDeposit;
    steam -= WATER.steamDecay * FIRE.tickInterval;
    steam = std.clamp(steam, 0, 1);

    let newFuel = fuel - newHeat * FIRE.fuelBurnRate;
    if (newHeat === 0) {
      newFuel = fuel + FIRE.fuelRegrow;
    }
    newFuel = std.clamp(newFuel, 0, FIRE.fuelInit);

    cells.$[idx + FIELD.FUEL] = d.i32(newFuel * FP);
    cells.$[idx + FIELD.HEAT] = d.i32(newHeat * FP);
    cells.$[idx + FIELD.STEAM] = d.i32(steam * FP);
  });

  const emberPass = createKernel(gpu, [FIELD_TOTAL], (i: number) => {
    'use gpu';
    const cell = d.u32(i);
    const idx = d.i32(cell) * FIELD.STRIDE;
    const heat = d.f32(cells.$[idx + FIELD.HEAT]) * INV_FP;
    const steam = d.f32(cells.$[idx + FIELD.STEAM]) * INV_FP;
    if (heat < 0.15 && steam < WATER.steamScaldThreshold) {
      return;
    }
    seedFieldCell(cell, simParams.$.time);
    const cx = cell % FIRE.cells;
    const cz = d.u32(cell / FIRE.cells);
    const wx = (d.f32(cx) + randf.sample()) * FIELD_CELL - FIRE.half;
    const wz = (d.f32(cz) + randf.sample()) * FIELD_CELL - FIRE.half;
    const steamP = steam * steam * simParams.$.dt * WATER.steamRate;
    if (steam >= WATER.steamScaldThreshold && randf.sample() < steamP) {
      emitters.emitSteam(d.vec2f(wx, wz));
    }
    if (heat >= 0.15 && randf.sample() < heat * simParams.$.dt * FIRE.emberRate) {
      emitters.emitEmber(d.vec2f(wx, wz), heat);
    }
  });

  const runner = makeFixedStepRunner(FIRE.tickInterval, FIRE.idleTickInterval, 3, (enc) =>
    step.run(enc),
  );
  const COS_HALF = Math.cos((FIRE.coneHalfAngleDeg * Math.PI) / 180);
  let dirty = false;

  return {
    ignite(px: number, pz: number, dx: number, dz: number) {
      const patch: Record<number, number> = {};
      paintCone(px, pz, dx, dz, FIRE.coneRange, COS_HALF, 0.55, (base, falloff) => {
        patch[base + FIELD.HEAT] = Math.round(FIRE.igniteHeat * falloff * FP);
      });
      fieldBuf.patch(patch);
      dirty = true;
    },
    igniteAt(px: number, pz: number, r: number, heatFrac: number) {
      const patch: Record<number, number> = {};
      paintDisc(px, pz, r, 0.55, (base, falloff) => {
        patch[base + FIELD.HEAT] = Math.round(FIRE.igniteHeat * heatFrac * falloff * FP);
      });
      fieldBuf.patch(patch);
      dirty = true;
    },
    run(dt: number, active: boolean, enc: GPUCommandEncoder) {
      const stepped = runner.run(dt, active, enc) > 0;
      if (active) emberPass.run(enc);
      const wrote = dirty || stepped;
      dirty = false;
      return wrote;
    },
    reset() {
      fieldBuf.write(pristineFieldCells());
      runner.reset();
      dirty = true;
    },
  };
}
