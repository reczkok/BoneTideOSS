import { d, std } from 'typegpu';
import { BLADES } from '../config.ts';

export const bladeAngle = (time: number, k: number, count: number) => {
  'use gpu';
  return time * BLADES.spin + (k * 6.2831853) / count;
};

export const orbitPos = (center: d.v2f, angle: number, radius: number) => {
  'use gpu';
  return center + d.vec2f(std.sin(angle), std.cos(angle)) * radius;
};

export const flightPos = (origin: d.v2f, dir: d.v2f, age: number, speed: number) => {
  'use gpu';
  return origin + dir * (age * d.f32(speed));
};
