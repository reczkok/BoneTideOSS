/**
 * Per-tick simulation parameters, declared once as an accessor so every sim
 * kernel reads `simParams.$` and `createSim` binds the real uniform with
 * `root.with(...)`.
 */
import tgpu from 'typegpu';
import { SimParams } from '../core/schemas.ts';

export const simParams = tgpu.accessor(SimParams);
