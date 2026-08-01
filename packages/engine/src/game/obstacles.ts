import type { Sfx } from '../audio/contract.ts';
import { ICE_ROCKS, MAX_SPIKE_ROCKS, SPIKES } from '../config.ts';
import type { PropInstanceSpec } from '../renderer/props.ts';
import type { RockCollider } from '../core/world.ts';
import { clampToArena } from './aim.ts';
import { rockFrostBreath, rockMeltBurst, rockMeltDrip } from './effects.ts';
import type { ParticleSpec } from '../renderer/particles.ts';

interface ObstacleDeps {
  setSimRocks(rocks: readonly RockCollider[]): void;
  updateProps(instances: readonly PropInstanceSpec[]): void;
  emit(specs: ParticleSpec[]): void;
  sfx: Sfx;
}

interface Slot {
  x: number;
  z: number;
  bornAt: number;
  expiresAt: number;
  rot: number;
  melting: boolean;
  lastDrip: number;
}

export function createObstacles(deps: ObstacleDeps) {
  const slots: Slot[] = Array.from({ length: MAX_SPIKE_ROCKS }, () => ({
    x: 0,
    z: 0,
    bornAt: -100,
    expiresAt: -100,
    rot: 0,
    melting: false,
    lastDrip: 0,
  }));
  const colliders: RockCollider[] = Array.from({ length: MAX_SPIKE_ROCKS }, () => ({
    x: 0,
    z: 0,
    r: 0,
  }));
  const propScratch: PropInstanceSpec[] = Array.from({ length: MAX_SPIKE_ROCKS }, () => ({
    pos: [0, -100, 0],
    rotCS: [1, 0],
    scale: 0,
    sway: 0,
  }));
  let cursor = 0;
  let live = false;

  function hide(i: number) {
    const c = colliders[i];
    c.x = 0;
    c.z = 0;
    c.r = 0;
    const p = propScratch[i];
    p.pos[0] = 0;
    p.pos[1] = -100;
    p.pos[2] = 0;
    p.scale = 0;
  }

  function spawnLine(x: number, z: number, dx: number, dz: number, now: number) {
    const sideX = dz;
    const sideZ = -dx;
    for (let k = 0; k < SPIKES.rocksPerCast; k++) {
      const slot = slots[cursor];
      cursor = (cursor + 1) % MAX_SPIKE_ROCKS;
      const t =
        SPIKES.rocksPerCast === 1
          ? SPIKES.rockSoloAt
          : SPIKES.rockLineStart + (SPIKES.rockLineSpan * k) / (SPIKES.rocksPerCast - 1);
      const lateral = (Math.random() - 0.5) * SPIKES.rockLateralJitter;
      slot.x = x + dx * (SPIKES.range * t) + sideX * lateral;
      slot.z = z + dz * (SPIKES.range * t) + sideZ * lateral;
      clampToArena(slot, SPIKES.rockEdgeMargin);
      slot.bornAt = now;
      slot.expiresAt = now + SPIKES.rockLifetime;
      slot.rot = Math.random() * Math.PI * 2;
      slot.melting = false;
      slot.lastDrip = now + Math.random() * ICE_ROCKS.breathInterval;
    }
    update(now);
  }

  function update(now: number) {
    let anyLive = false;
    for (let i = 0; i < MAX_SPIKE_ROCKS; i++) {
      const slot = slots[i];
      const p = propScratch[i];
      const c = colliders[i];
      if (slot.bornAt < 0) {
        hide(i);
        continue;
      }
      const age = now - slot.bornAt;
      const crumble = now - slot.expiresAt;
      if (crumble >= SPIKES.crumbleTime) {
        slot.bornAt = -100;
        hide(i);
        continue;
      }
      anyLive = true;

      let y = 0;
      let scale = 1;
      let radius = SPIKES.rockRadius;
      if (age < SPIKES.riseTime) {
        const t = Math.max(0, age / SPIKES.riseTime);
        y = -SPIKES.riseDepth * (1 - t);
        scale = t;
        radius = t >= 0.6 ? SPIKES.rockRadius : 0;
      } else if (crumble >= 0) {
        if (!slot.melting) {
          slot.melting = true;
          slot.lastDrip = now;
          deps.emit(rockMeltBurst(slot.x, slot.z));
          deps.sfx('ice_melt', { x: slot.x, z: slot.z });
        }
        const t = crumble / SPIKES.crumbleTime;
        if (now - slot.lastDrip >= ICE_ROCKS.meltDripInterval) {
          slot.lastDrip = now;
          deps.emit(rockMeltDrip(slot.x, slot.z, t));
        }
        y = -SPIKES.sinkDepth * t;
        scale = 1 - SPIKES.crumbleShrink * t;
        radius = 0;
      } else if (now - slot.lastDrip >= ICE_ROCKS.breathInterval) {
        slot.lastDrip = now;
        deps.emit(rockFrostBreath(slot.x, slot.z));
      }

      c.x = slot.x;
      c.z = slot.z;
      c.r = radius;
      p.pos[0] = slot.x;
      p.pos[1] = y;
      p.pos[2] = slot.z;
      p.rotCS[0] = Math.cos(slot.rot);
      p.rotCS[1] = Math.sin(slot.rot);
      p.scale = scale * SPIKES.rockRadius;
      p.sway = 0;
    }
    if (!anyLive && !live) return;
    live = anyLive;
    deps.setSimRocks(colliders);
    deps.updateProps(propScratch);
  }

  return {
    colliders,
    spawnLine,
    update,
  };
}

export type Obstacles = ReturnType<typeof createObstacles>;
