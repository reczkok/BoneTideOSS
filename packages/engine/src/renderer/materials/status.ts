/**
 * Status-effect looks layered onto shaded actors: elite/boss auras, attack
 * wind-up rim, poison, chill, burn, shock and deep-freeze.
 */
import { d, std } from 'typegpu';
import { perlin2d } from '@typegpu/noise';
import { BOSS, CHAIN, KEYSTONES, STATUS, TELEGRAPH } from '../../config.ts';
import { fresnel, luma } from '../../core/gpu.ts';
import { Actor, ACTOR_FLAGS } from '../../core/schemas.ts';
import { BURN_COL, CHILL_COL, POISON_COL, SHOCK_COL } from '../../statuscolors.ts';
import { camera } from '../scene/bindings.ts';
import { viewDirTo } from '../scene/lighting.ts';

const BOSS_RIM_COL = d.vec3f(...BOSS.aura.rimColor);
const WINDUP_RIM_COL = d.vec3f(...TELEGRAPH.bodyRim);
const WINDUP_RAMP_INV = 1 / TELEGRAPH.bodyRamp;
const FREEZE_T = KEYSTONES.flashFreeze.freezeThreshold;

/**
 * An actor's active effects, packed for the vertex→fragment hop.
 * aura = (elite, boss, windup, strike), status = (poison, chill, shock, burn).
 */
export const StatusFx = d.struct({
  aura: d.vec4f,
  status: d.vec4f,
  freeze: d.f32,
});

const flag = (a: d.InferGPU<typeof Actor>, bit: number) => {
  'use gpu';
  return std.select(d.f32(0), d.f32(1), (a.flags & d.u32(bit)) !== 0);
};

export const statusFxOf = (a: d.InferGPU<typeof Actor>) => {
  'use gpu';
  const windup = std.select(
    d.f32(0),
    std.clamp(1 - a.windupT * WINDUP_RAMP_INV, 0, 1),
    a.windupT > 0.001,
  );
  const strike = std.smoothstep(
    CHAIN.stunTime - STATUS.shock.strikeWindow,
    CHAIN.stunTime - 0.02,
    a.shockT,
  );
  return StatusFx({
    aura: d.vec4f(flag(a, ACTOR_FLAGS.ELITE), flag(a, ACTOR_FLAGS.BOSS), windup, strike),
    status: d.vec4f(
      std.min(a.poisonT * 2, 1),
      std.min(a.chillT * 2, 1),
      std.min(a.shockT * 2.5, 1),
      a.burnH,
    ),
    freeze: std.smoothstep(FREEZE_T - 0.2, FREEZE_T, a.chillT),
  });
};

export const actorStatusShade = (
  lit: d.v3f,
  albedo: d.v3f,
  wNormal: d.v3f,
  wPos: d.v3f,
  seed: number,
  fx: d.InferGPU<typeof StatusFx>,
) => {
  'use gpu';
  const t = camera.$.time;
  const nn = std.normalize(wNormal);
  const viewDir = viewDirTo(wPos);
  const lum = luma(albedo);
  const elite = fx.aura.x;
  const boss = fx.aura.y;
  const windup = fx.aura.z;
  const strike = fx.aura.w;
  const poison = fx.status.x;
  const chill = fx.status.y;
  const shock = fx.status.z;
  const burn = fx.status.w;
  let color = d.vec3f(lit);

  const pulse = 0.35 + 0.25 * std.sin(t * 5);
  color += d.vec3f(0.3, 0.12, 0.5) * (elite * pulse);
  if (boss > 0.5) {
    const bossPulse = 1 + BOSS.aura.pulseDepth * std.sin(t * BOSS.aura.pulseSpeed);
    const rim = fresnel(nn, viewDir, BOSS.aura.rimExponent);
    color += BOSS_RIM_COL * (rim * BOSS.aura.rimStrength * bossPulse);
  }
  if (windup > 0.001) {
    const rim = fresnel(nn, viewDir, TELEGRAPH.bodyRimExp);
    color += WINDUP_RIM_COL * (windup * rim * TELEGRAPH.bodyStrength);
  }

  color = std.mix(color, CHILL_COL * (lum + 0.15), chill * STATUS.chill.tint);
  const poisonPulse = 0.75 + 0.25 * std.sin(t * 3 + wPos.x * 2);
  color = std.mix(
    color,
    POISON_COL * (lum * 0.8 + 0.08),
    poison * STATUS.poison.tint * poisonPulse,
  );
  const burnFlicker = 0.65 + 0.35 * std.sin(t * 23 + wPos.x * 7 + seed * 30);
  const lowGrad = std.smoothstep(1.9, 0.15, wPos.y);
  color += BURN_COL * (burn * burnFlicker * (0.3 + 1.1 * lowGrad));

  if (shock > 0.001) {
    const snapT = std.floor(t * 24) * 4.17;
    const vein = perlin2d.sample(
      d.vec2f(wPos.x * 3.1 + wPos.y * 2.3 + snapT, wPos.z * 3.1 - wPos.y * 1.7 - snapT),
    );
    const staticN = std.smoothstep(0.2, 0.55, vein);
    const rim = fresnel(nn, viewDir, 2);
    const strobe = std.pow(std.max(0, std.sin(t * 13 + seed * 40)), 12);
    color +=
      SHOCK_COL * (shock * (0.12 + 1.5 * staticN + rim * (0.55 + 0.9 * strobe) + 1.2 * strobe));
    color += d.vec3f(1.6, 1.8, 2.1) * (shock * staticN * strobe);
    color += (SHOCK_COL * 0.5 + d.vec3f(1.5, 1.6, 1.8)) * (strike * STATUS.shock.strikeFlash);
  }
  if (fx.freeze > 0.001) {
    const fz = fx.freeze;
    color = std.mix(color, d.vec3f(0.65, 0.78, 0.95) * (lum * 0.6 + 0.45), fz * 0.75);
    color += d.vec3f(0.8, 1.3, 2.0) * (fresnel(nn, viewDir, 2.2) * fz * 1.4);
    const twinkle = std.pow(std.max(0, std.sin(t * 3.3 + seed * 55 + wPos.y * 4 + wPos.x * 3)), 24);
    color += d.vec3f(1.2, 1.8, 2.6) * (twinkle * fz * 0.8);
  }
  return color;
};
