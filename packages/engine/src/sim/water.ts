import { d, std, type TgpuRoot, type WithBinding } from 'typegpu';
import { createKernel } from '../core/kernel.ts';
import { randf } from '@typegpu/noise';
import { ARENA_RADIUS, FIELD, WATER } from '../config.ts';
import type { FieldBuffer } from '../core/schemas.ts';
import { simParams } from './bindings.ts';
import type { GpuEmitters } from './emitters.ts';
import {
  FIELD_CELL as CELL,
  FIELD_TOTAL as TOTAL,
  FP,
  INV_FP,
  makeFixedStepRunner,
  paintCone,
  seedFieldCell,
} from './field.ts';

const STRIDE = FIELD.STRIDE;
const MAX_WAVES = Math.max(WATER.baseWaves, WATER.floodWaves);

export function createWaterField(
  root: TgpuRoot,
  gpu: WithBinding,
  emitters: GpuEmitters,
  fieldBuf: FieldBuffer,
): {
  surge(
    px: number,
    pz: number,
    dx: number,
    dz: number,
    power: number,
    now: number,
    until: number,
    fresh: boolean,
    waves: number,
    crestScale: number,
  ): void;
  run(dt: number, active: boolean, enc: GPUCommandEncoder): boolean;
  reset(): void;
} {
  const cells = fieldBuf.as('mutable');

  const Jet = d.struct({
    pos: d.vec2f,
    dir: d.vec2f,
    depth: d.f32,
    range: d.f32,
    start: d.f32,
    until: d.f32,
    waves: d.f32,
    crestScale: d.f32,
  });
  const jetOff = {
    pos: d.vec2f(),
    dir: d.vec2f(0, 1),
    depth: 0,
    range: 0,
    start: 0,
    until: -1,
    waves: 0,
    crestScale: 1,
  };
  const jet = root.createUniform(Jet, jetOff);
  const COS_HALF = Math.cos((WATER.coneHalfAngleDeg * Math.PI) / 180);

  const depthAt = (base: number, selfH: number, inBounds: boolean) => {
    'use gpu';
    return std.select(d.f32(selfH), d.f32(cells.$[base + FIELD.WATER_H]) * INV_FP, inBounds);
  };

  const step = createKernel(gpu, [TOTAL], (i: number) => {
    'use gpu';
    const cell = d.u32(i);
    const cx = cell % WATER.cells;
    const cz = d.u32(cell / WATER.cells);
    const idx = d.i32(cell) * STRIDE;
    const h = d.f32(cells.$[idx + FIELD.WATER_H]) * INV_FP;
    let vx = d.f32(cells.$[idx + FIELD.WATER_VX]) * INV_FP;
    let vz = d.f32(cells.$[idx + FIELD.WATER_VZ]) * INV_FP;

    const hasW = cx > 0;
    const hasE = cx < WATER.cells - 1;
    const hasN = cz > 0;
    const hasS = cz < WATER.cells - 1;
    const iW = idx - STRIDE;
    const iE = idx + STRIDE;
    const iN = idx - WATER.cells * STRIDE;
    const iS = idx + WATER.cells * STRIDE;
    const hW = depthAt(iW, h, hasW);
    const hE = depthAt(iE, h, hasE);
    const hN = depthAt(iN, h, hasN);
    const hS = depthAt(iS, h, hasS);

    vx = (vx - ((hE - hW) / (2 * CELL)) * WATER.gAccel * WATER.tickInterval) * WATER.damping;
    vz = (vz - ((hS - hN) / (2 * CELL)) * WATER.gAccel * WATER.tickInterval) * WATER.damping;
    vx = std.clamp(vx, -WATER.vMax, WATER.vMax);
    vz = std.clamp(vz, -WATER.vMax, WATER.vMax);

    const fxE = hE * std.select(d.f32(0), d.f32(cells.$[iE + FIELD.WATER_VX]) * INV_FP, hasE);
    const fxW = hW * std.select(d.f32(0), d.f32(cells.$[iW + FIELD.WATER_VX]) * INV_FP, hasW);
    const fzS = hS * std.select(d.f32(0), d.f32(cells.$[iS + FIELD.WATER_VZ]) * INV_FP, hasS);
    const fzN = hN * std.select(d.f32(0), d.f32(cells.$[iN + FIELD.WATER_VZ]) * INV_FP, hasN);
    const div = (fxE - fxW + fzS - fzN) / (2 * CELL);

    const hAvg = (hW + hE + hN + hS) * 0.25;
    let newH = h + (hAvg - h) * WATER.smooth - div * WATER.tickInterval;

    newH -= WATER.drainRate * WATER.tickInterval;
    const fireHeat = d.f32(cells.$[idx + FIELD.HEAT]) * INV_FP;
    newH -= fireHeat * WATER.evapRate * WATER.tickInterval;

    const wx = (d.f32(cx) + 0.5) * CELL - WATER.half;
    const wz = (d.f32(cz) + 0.5) * CELL - WATER.half;

    if (simParams.$.time < jet.$.until) {
      const rel = d.vec2f(wx - jet.$.pos.x, wz - jet.$.pos.y);
      const dist = std.length(rel);
      if (dist < jet.$.range && dist > 1e-3) {
        const n = rel * (1 / dist);
        if (n.x * jet.$.dir.x + n.y * jet.$.dir.y > COS_HALF) {
          let crest = d.f32(0);
          for (let k = 0; k < MAX_WAVES; k++) {
            const ageK = simParams.$.time - jet.$.start - d.f32(k) * WATER.wavePeriod;
            const rawK = ageK * WATER.frontSpeed + WATER.crestWidth;
            const frontK = std.min(rawK, jet.$.range);
            const lifeK = 1 - std.smoothstep(jet.$.range, jet.$.range + 3, rawK);
            const band = 1 - std.smoothstep(0, WATER.crestWidth, std.abs(dist - frontK));
            const on = std.select(d.f32(0), d.f32(1), ageK >= 0 && d.f32(k) < jet.$.waves);
            crest = std.max(crest, band * lifeK * on);
          }
          const rawLead = (simParams.$.time - jet.$.start) * WATER.frontSpeed + WATER.crestWidth;
          const frontLead = std.min(rawLead, jet.$.range);
          const river = (1 - std.smoothstep(frontLead, frontLead + WATER.crestWidth, dist)) * 0.55;
          const target =
            jet.$.depth *
            std.max(crest * jet.$.crestScale, river) *
            (1 - (dist / jet.$.range) * 0.35);
          newH = std.max(newH, target);
          const sp = std.min(d.f32(WATER.surgeSpeed) * jet.$.crestScale, d.f32(WATER.vMax));
          const aim = std.mix(0.25, 0.75, crest);
          vx = std.mix(vx, n.x * sp, aim);
          vz = std.mix(vz, n.y * sp, aim);
        }
      }
    }

    if (wx * wx + wz * wz > ARENA_RADIUS * ARENA_RADIUS) {
      newH *= 1 - WATER.edgeSpill;
      vx *= 1 - WATER.edgeSpill * 0.5;
      vz *= 1 - WATER.edgeSpill * 0.5;
    }

    newH = std.clamp(newH, 0, WATER.hMax);
    if (newH < 0.01) {
      newH = 0;
      vx = 0;
      vz = 0;
    }
    cells.$[idx + FIELD.WATER_H] = d.i32(newH * FP);
    cells.$[idx + FIELD.WATER_VX] = d.i32(vx * FP);
    cells.$[idx + FIELD.WATER_VZ] = d.i32(vz * FP);
  });

  const clearPass = createKernel(gpu, [TOTAL], (i: number) => {
    'use gpu';
    const idx = d.i32(d.u32(i)) * STRIDE;
    cells.$[idx + FIELD.WATER_H] = 0;
    cells.$[idx + FIELD.WATER_VX] = 0;
    cells.$[idx + FIELD.WATER_VZ] = 0;
  });

  const sprayPass = createKernel(gpu, [TOTAL], (i: number) => {
    'use gpu';
    const cell = d.u32(i);
    const idx = d.i32(cell) * STRIDE;
    const h = d.f32(cells.$[idx + FIELD.WATER_H]) * INV_FP;
    if (h < 0.04) {
      return;
    }
    seedFieldCell(cell, simParams.$.time);
    const cx = cell % WATER.cells;
    const cz = d.u32(cell / WATER.cells);
    const wx = (d.f32(cx) + randf.sample()) * CELL - WATER.half;
    const wz = (d.f32(cz) + randf.sample()) * CELL - WATER.half;

    const zapT = simParams.$.time - simParams.$.waterZapStart;
    if (
      simParams.$.waterZapStart >= 0 &&
      zapT >= 0 &&
      zapT < WATER.zapDuration &&
      h > WATER.drenchThreshold
    ) {
      const bx = d.f32(cx / WATER.zapHotspotCells);
      const bz = d.f32(cz / WATER.zapHotspotCells);
      const phase = std.floor(simParams.$.time * 9);
      const hot = std.fract(std.sin(bx * 12.9898 + bz * 78.233 + phase * 3.71) * 43758.547);
      if (hot > 1 - WATER.zapHotspotFrac && randf.sample() < simParams.$.dt * WATER.zapArcRate) {
        emitters.emitWaterArc(d.vec2f(wx, wz));
      }
    }

    const vx = d.f32(cells.$[idx + FIELD.WATER_VX]) * INV_FP;
    const vz = d.f32(cells.$[idx + FIELD.WATER_VZ]) * INV_FP;
    const speed = std.length(d.vec2f(vx, vz));
    if (h < 0.1 || speed < 2) {
      return;
    }
    if (randf.sample() > std.min(speed * 0.25, 1) * simParams.$.dt * WATER.sprayRate) {
      return;
    }
    emitters.emitSpray(d.vec2f(wx, wz), d.vec2f(vx, vz));
  });

  const runner = makeFixedStepRunner(WATER.tickInterval, WATER.idleTickInterval, 4, (enc) =>
    step.run(enc),
  );

  let wasActive = false;
  let dirty = false;

  return {
    surge(px, pz, dx, dz, power, now, until, fresh, waves, crestScale) {
      if (fresh) {
        const enc = root.device.createCommandEncoder();
        clearPass.run(enc);
        root.device.queue.submit([enc.finish()]);
      }
      const patch: Record<number, number> = {};
      const r = WATER.coneRange * Math.sqrt(power);
      const depth = Math.min(WATER.surgeHeight * power, WATER.hMax);
      jet.write({
        pos: d.vec2f(px, pz),
        dir: d.vec2f(dx, dz),
        depth,
        range: r,
        start: now,
        until,
        waves,
        crestScale,
      });
      const sp = Math.min(WATER.surgeSpeed * crestScale, WATER.vMax);
      paintCone(
        px,
        pz,
        dx,
        dz,
        Math.min(WATER.crestWidth * 1.5, r),
        COS_HALF,
        0.5,
        (base, falloff, nx, nz) => {
          patch[base + FIELD.WATER_H] = Math.round(depth * falloff * FP);
          patch[base + FIELD.WATER_VX] = Math.round(nx * sp * FP);
          patch[base + FIELD.WATER_VZ] = Math.round(nz * sp * FP);
        },
      );
      fieldBuf.patch(patch);
      dirty = true;
    },
    run(dt, active, enc) {
      const stepped = runner.run(dt, active, enc) > 0;
      let wrote = dirty || stepped;
      dirty = false;
      if (active) {
        sprayPass.run(enc);
      } else if (wasActive) {
        clearPass.run(enc);
        wrote = true;
      }
      wasActive = active;
      return wrote;
    },
    reset() {
      jet.write(jetOff);
      runner.reset();
      wasActive = false;
    },
  };
}
