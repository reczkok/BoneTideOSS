import { d } from 'typegpu';
import { STATUS } from './config.ts';

const rgb = (c: readonly number[]) => d.vec3f(c[0], c[1], c[2]);
const bounce = (s: { color: readonly number[]; giBounce: number }) =>
  d.vec3f(s.color[0] * s.giBounce, s.color[1] * s.giBounce, s.color[2] * s.giBounce);

export const POISON_COL = rgb(STATUS.poison.color);
export const CHILL_COL = rgb(STATUS.chill.color);
export const SHOCK_COL = rgb(STATUS.shock.color);
export const BURN_COL = rgb(STATUS.burn.color);

export const POISON_EMIT = bounce(STATUS.poison);
export const CHILL_EMIT = bounce(STATUS.chill);
export const SHOCK_EMIT = bounce(STATUS.shock);
export const BURN_EMIT = bounce(STATUS.burn);
