/**
 * Ground deformation and the wind fields abilities push through the scene.
 * Shared by the ground mesh, foliage, particles and fireflies so every
 * system agrees on where the ground is and which way it is blowing.
 */
import { d, std } from 'typegpu';
import { perlin2d } from '@typegpu/noise';
import { METEOR, SHOCK, SPIKES, WELL } from '../../config.ts';
import { lateral } from '../../core/gpu.ts';
import { camera, fx } from './bindings.ts';

const SHOCK_REACH = SHOCK.maxRadius + SHOCK.width;

const shockHeight = (p: d.v2f) => {
  'use gpu';
  let y = d.f32(0);
  const t = camera.$.time - fx.$.shockStart;
  const r = t * SHOCK.speed;
  const dist = std.distance(p, fx.$.shockOrigin);
  if (r < SHOCK_REACH) {
    const dr = dist - r;
    y += std.exp(-dr * dr * 1.4) * 0.55 * (1 - r / SHOCK_REACH);
  }
  if (t < SHOCK.crackDuration) {
    const reach = std.min(t * SHOCK.speed, SHOCK.maxRadius);
    const inside = std.smoothstep(reach, reach - 2, dist);
    const fade = 1 - t / SHOCK.crackDuration;
    const rubble = perlin2d.sample((p - fx.$.shockOrigin) * 1.15) * 0.09;
    y += (rubble - 0.1) * inside * fade;
  }
  return y;
};

const craterHeight = (p: d.v2f) => {
  'use gpu';
  let y = d.f32(0);
  const t = camera.$.time - fx.$.meteorImpact;
  if (t >= 0 && t < METEOR.craterDuration) {
    const dist = std.distance(p, fx.$.meteorPos);
    const fade = 1 - t / METEOR.craterDuration;
    const bowl = std.smoothstep(METEOR.radius * 0.85, 0, dist);
    const rim = std.smoothstep(1.4, 0, std.abs(dist - METEOR.radius * 0.85));
    const rubble = perlin2d.sample((p - fx.$.meteorPos) * 1.3) * 0.08;
    y += (-bowl * 0.5 + rim * 0.18 + rubble * bowl) * fade;
  }
  return y;
};

/** Ridge profile of the ice spikes, 0..1, shared with the ground's frost tint. */
export const spikeTooth = (p: d.v2f) => {
  'use gpu';
  const n1 = perlin2d.sample(p * 2.1 + d.vec2f(31.7, 8.9));
  const n2 = perlin2d.sample(p * 4.3 + d.vec2f(7.7, 53.1));
  return std.pow(std.smoothstep(0.12, 0.85, std.max(n1 * 0.75 + n2 * 0.45, 0)), 1.6);
};

const spikeHeight = (p: d.v2f) => {
  'use gpu';
  let y = d.f32(0);
  const t = camera.$.time - fx.$.spikeStart;
  if (t >= 0 && t < SPIKES.duration) {
    const rel = p - fx.$.spikeOrigin;
    const along = std.dot(rel, fx.$.spikeDir);
    const lat = std.abs(lateral(rel, fx.$.spikeDir));
    if (along > -0.5 && along < SPIKES.range + 2.5 && lat < SPIKES.width + 0.8) {
      const front = std.min(t * SPIKES.speed, SPIKES.range);
      let pop = std.smoothstep(front + 0.3, front - 0.9, along);
      pop = pop * pop * std.smoothstep(-0.4, 0.4, along);
      const across = std.smoothstep(SPIKES.width, SPIKES.width * 0.35, lat);
      const sink = 1 - std.smoothstep(SPIKES.duration * 0.55, SPIKES.duration, t);
      y += spikeTooth(p) * SPIKES.height * pop * across * sink;
      if (front < SPIKES.range) {
        const db = along - (front + 1.3);
        const wideLat = std.smoothstep(SPIKES.width + 0.8, 0, lat);
        y += std.exp(-db * db * 0.9) * 0.34 * wideLat;
      }
    }
  }
  return y;
};

const wellHeight = (p: d.v2f) => {
  'use gpu';
  let y = d.f32(0);
  const wt = camera.$.time - fx.$.wellStart;
  const dist = std.distance(p, fx.$.wellPos);
  if (wt >= 0 && wt < WELL.duration) {
    if (dist < WELL.radius) {
      const rampIn = std.min(wt * 4, 1);
      const dish = std.smoothstep(WELL.radius, 0, dist);
      y -= dish * dish * 0.5 * rampIn;
    }
  } else if (wt >= WELL.duration && wt < WELL.duration + 0.7) {
    const ct = wt - WELL.duration;
    const dr = dist - ct * 26;
    y += std.exp(-dr * dr * 1.6) * 0.4 * (1 - ct / 0.7);
  }
  return y;
};

/** World-space ground height at `p`, summing every active deformation. */
export const groundHeight = (p: d.v2f) => {
  'use gpu';
  let y = d.f32(0);
  if (fx.$.shockStart >= 0) {
    y += shockHeight(p);
  }
  if (fx.$.meteorImpact >= 0) {
    y += craterHeight(p);
  }
  if (fx.$.spikeStart >= 0) {
    y += spikeHeight(p);
  }
  if (fx.$.wellStart >= 0) {
    y += wellHeight(p);
  }
  return y;
};

/** Outward gust from the expanding nova ring. */
export const novaGust = (p: d.v2f) => {
  'use gpu';
  let gust = d.vec2f();
  if (fx.$.shockStart >= 0) {
    const r = (camera.$.time - fx.$.shockStart) * SHOCK.speed;
    if (r < SHOCK_REACH) {
      const rel = p - fx.$.shockOrigin;
      const dr = std.length(rel);
      const band = std.smoothstep(2.2, 0, std.abs(dr - r));
      if (band > 0.001 && dr > 1e-3) {
        gust = rel * ((band * (1 - r / SHOCK_REACH)) / dr);
      }
    }
  }
  return gust;
};

/** Outward blast from the meteor impact. */
export const meteorGust = (p: d.v2f) => {
  'use gpu';
  let gust = d.vec2f();
  if (fx.$.meteorImpact >= 0) {
    const t = camera.$.time - fx.$.meteorImpact;
    if (t >= 0 && t < 0.7) {
      const rel = p - fx.$.meteorPos;
      const dr = std.length(rel);
      if (dr > 1e-3) {
        gust = rel * ((std.exp(-t * 5) * std.smoothstep(9, 0.5, dr)) / dr);
      }
    }
  }
  return gust;
};

/** Inward swirl of the gravity well. */
export const wellPull = (p: d.v2f) => {
  'use gpu';
  let pull = d.vec2f();
  if (fx.$.wellStart >= 0) {
    const t = camera.$.time - fx.$.wellStart;
    if (t >= 0 && t < WELL.duration) {
      const rel = fx.$.wellPos - p;
      const dr = std.length(rel);
      if (dr > 1e-3 && dr < WELL.radius) {
        const inward = rel * (1 / dr);
        const tangent = d.vec2f(-inward.y, inward.x);
        const ramp = std.min(std.min(t * 4, 1), (WELL.duration - t) * 2.5);
        const prof = std.smoothstep(WELL.radius, WELL.radius * 0.1, dr) * ramp;
        pull = (inward + tangent * WELL.swirl) * prof;
      }
    }
  }
  return pull;
};

/** Combined gust + pull, the wind that particles and foliage respond to. */
export const windAt = (p: d.v2f) => {
  'use gpu';
  return novaGust(p) + meteorGust(p) + wellPull(p);
};
