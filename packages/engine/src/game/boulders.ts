import type { Sfx } from '../audio/contract.ts';
import { BOSS, MAGEBOLT, PLAYER } from '../config.ts';
import { lerp, normalize2 } from '../core/mathx.ts';
import type { LightSpec, SteadyLightSpec } from '../renderer/env.ts';
import type { ParticleSpec } from '../renderer/particles.ts';
import type { PropInstanceSpec } from '../renderer/props.ts';
import { boltHead, boltWake, boulderTrail, orbBurst, slamImpact } from './effects.ts';
import type { Hud } from './hud.ts';
import type { Player } from './player.ts';
import { TG_KIND, type Telegraphs } from './telegraphs.ts';

const ROCK = 0;
const ORB = 1;

interface Lob {
  kind: number;
  ox: number;
  oz: number;
  tx: number;
  tz: number;
  start: number;
  flight: number;
  speed: number;
  damage: number;
  key: number;
}

const KEY_BASE = 1 << 20;

export function createBoulders(deps: {
  player: Player;
  hud: Hud;
  emit(specs: ParticleSpec[]): void;
  updateRocks(instances: readonly PropInstanceSpec[]): void;
  steadyLight(key: string, spec: SteadyLightSpec | null): void;
  light(spec: LightSpec): void;
  orbSpeedMul: number;
  sfx: Sfx;
  shake(amp: number): void;
  telegraph: Telegraphs;
}) {
  const { player, hud, emit, updateRocks, steadyLight, light, orbSpeedMul, sfx, shake, telegraph } =
    deps;
  const lobs: Lob[] = [];
  let nextRockKey = 0;
  let nextOrbKey = 0;
  let rockCount = 0;
  let orbCount = 0;

  const rockScratch: PropInstanceSpec[] = Array.from({ length: BOSS.boulder.maxInFlight }, () => ({
    pos: [0, -100, 0],
    rotCS: [1, 0],
    scale: 0,
    sway: 0,
  }));
  let rocksShown = false;
  const lightSpecs: SteadyLightSpec[] = Array.from({ length: BOSS.boulder.maxInFlight }, () => ({
    x: 0,
    y: 0,
    z: 0,
    color: BOSS.boulder.glow.color,
    radius: BOSS.boulder.glow.radius,
  }));

  function arm(
    kind: number,
    ox: number,
    oz: number,
    tx: number,
    tz: number,
    now: number,
    damage: number,
  ) {
    const cfg = kind === ROCK ? BOSS.boulder : MAGEBOLT;
    const speed = kind === ROCK ? cfg.flightSpeed : cfg.flightSpeed * orbSpeedMul;
    const flight = Math.max(0.35, Math.hypot(tx - ox, tz - oz) / speed);
    let key: number;
    if (kind === ROCK) {
      key = KEY_BASE + nextRockKey;
      nextRockKey = (nextRockKey + 1) % BOSS.boulder.maxInFlight;
      rockCount++;
    } else {
      key = KEY_BASE + BOSS.boulder.maxInFlight + nextOrbKey;
      nextOrbKey = (nextOrbKey + 1) % MAGEBOLT.maxInFlight;
      orbCount++;
    }
    telegraph.arm(key, TG_KIND.circle, tx, tz, 0, 1, cfg.radius, Math.PI, now, now + flight);
    lobs.push({ kind, ox, oz, tx, tz, start: now, flight, speed, damage, key });
  }

  return {
    throw(ox: number, oz: number, tx: number, tz: number, now: number, damage: number) {
      if (rockCount >= BOSS.boulder.maxInFlight) return;
      arm(ROCK, ox, oz, tx, tz, now, damage);
    },
    lobOrb(x: number, z: number, tx: number, tz: number, now: number, damage: number) {
      if (orbCount >= MAGEBOLT.maxInFlight) return;
      const aimX = tx - x;
      const aimZ = tz - z;
      const [fwdX, fwdZ, aimLen] = normalize2(aimX, aimZ);
      if (aimLen < 1e-3) return;
      const ox = x + fwdX * MAGEBOLT.muzzleForward + fwdZ * MAGEBOLT.muzzleRight;
      const oz = z + fwdZ * MAGEBOLT.muzzleForward - fwdX * MAGEBOLT.muzzleRight;
      arm(ORB, ox, oz, tx, tz, now, damage);
    },
    update(_dt: number, now: number) {
      if (lobs.length === 0) {
        if (rocksShown) {
          rocksShown = false;
          updateRocks([]);
        }
        return;
      }
      let w = 0;
      let rocksInFlight = 0;
      for (const b of lobs) {
        const rock = b.kind === ROCK;
        const cfg = rock ? BOSS.boulder : MAGEBOLT;
        const t = (now - b.start) / b.flight;
        if (t >= 1) {
          if (rock) {
            rockCount--;
            steadyLight(`boulder${b.key}`, null);
            emit(slamImpact(b.tx, b.tz, cfg.radius));
            sfx('boss_slam', { x: b.tx, z: b.tz, gain: 0.6, rate: 1.15 });
          } else {
            orbCount--;
            emit(orbBurst(b.tx, b.tz, cfg.radius));
            sfx('magebolt_hit', { x: b.tx, z: b.tz, gain: 0.8 });
            light({
              x: b.tx,
              y: 1.0,
              z: b.tz,
              color: [2.2, 0.7, 3.4],
              radius: cfg.radius * 3,
              life: 0.35,
            });
          }
          shake(cfg.shake);
          if (player.alive && player.invulnT <= 0) {
            const dx = player.x - b.tx;
            const dz = player.z - b.tz;
            const dist = Math.hypot(dx, dz);
            if (dist < cfg.radius + PLAYER.radius) {
              const falloff = 1 - (dist / (cfg.radius + PLAYER.radius)) * 0.65;
              player.damage(b.damage * falloff);
              hud.heat(cfg.heat);
            }
          }
          continue;
        }
        const x = lerp(b.ox, b.tx, t);
        const z = lerp(b.oz, b.tz, t);
        const y = cfg.launchHeight * (1 - t) + cfg.arcHeight * 4 * t * (1 - t);
        const dirX = (b.tx - b.ox) / (b.flight * b.speed);
        const dirZ = (b.tz - b.oz) / (b.flight * b.speed);
        if (rock) {
          emit(boulderTrail(x, y, z, dirX * b.speed, dirZ * b.speed));
          const inst = rockScratch[rocksInFlight];
          inst.pos[0] = x;
          inst.pos[1] = y;
          inst.pos[2] = z;
          const spin = (now - b.start) * BOSS.boulder.rockSpin + b.key * 1.7;
          inst.rotCS[0] = Math.cos(spin);
          inst.rotCS[1] = Math.sin(spin);
          inst.scale = BOSS.boulder.rockScale;
          const ls = lightSpecs[b.key - KEY_BASE];
          ls.x = x;
          ls.y = y;
          ls.z = z;
          steadyLight(`boulder${b.key}`, ls);
          rocksInFlight++;
        } else {
          const vx = dirX * b.speed;
          const vz = dirZ * b.speed;
          const vy = (-cfg.launchHeight + cfg.arcHeight * 4 * (1 - 2 * t)) / b.flight;
          const vlen = Math.hypot(vx, vy, vz) || 1;
          const ux = vx / vlen;
          const uy = vy / vlen;
          const uz = vz / vlen;
          emit(boltHead(x, y, z, ux, uy, uz));
          if (Math.random() < 0.6) emit(boltWake(x, y, z, ux, uy, uz));
        }
        lobs[w++] = b;
      }
      lobs.length = w;
      for (let i = rocksInFlight; i < BOSS.boulder.maxInFlight; i++) {
        rockScratch[i].pos[1] = -100;
        rockScratch[i].scale = 0;
      }
      if (rocksInFlight > 0) {
        rocksShown = true;
        updateRocks(rockScratch);
      } else if (rocksShown) {
        rocksShown = false;
        updateRocks([]);
      }
    },
  };
}

export type Boulders = ReturnType<typeof createBoulders>;
