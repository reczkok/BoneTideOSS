import type { Sfx, SfxLoop } from '../audio/contract.ts';
import {
  BLADES,
  FIRE,
  KEYSTONES,
  MAX_VOLLEY,
  METEOR,
  PLAYER_ANIM,
  SHOCK,
  SPIKES,
  VOLLEY,
  WATER,
  WELL,
} from '../config.ts';
import { CLIP } from '../core/animation.ts';
import { bladeAngle } from '../core/kinematics.ts';
import { saturate } from '../core/mathx.ts';
import { type CpuRecord, VolleyArrow } from '../core/schemas.ts';
import type { Sim } from '../sim/sim.ts';
import type { LightSpec, SteadyLightSpec } from '../renderer/env.ts';
import type { ParticleSpec } from '../renderer/particles.ts';
import { SpectralInstance, type SpectralInstanceSpec } from '../renderer/spectral.ts';
import {
  arrowHead,
  crescentTrail,
  delugeBurst,
  delugeFront,
  fireCone,
  meteorImpact,
  meteorTelegraph,
  meteorTrail,
  novaFlash,
  frostMist,
  singularityInfall,
  spearTrail,
  spikeRubble,
  volleyFlash,
  wakeBubbles,
  wellAccretion,
  wellBurst,
  wellCore,
} from './effects.ts';
import { aimDir, clampCastPoint, clampToArena } from './aim.ts';
import type { Input, SlotAction } from './input.ts';
import type { Loadout } from './loadout.ts';
import type { Obstacles } from './obstacles.ts';
import type { Player } from './player.ts';
import type { RunStats } from './stats.ts';

export interface AbilityDeps {
  input: Input;
  sim: Sim;
  stats: RunStats;
  loadout: Loadout;
  obstacles: Obstacles;
  sfx: Sfx;
  sfxLoop: SfxLoop;
  emit(specs: ParticleSpec[]): void;
  moveMeteorMesh(x: number, y: number, z: number, spin: number): void;
  shake(amp: number): void;
  flash(amp: number): void;
  light(spec: LightSpec): void;
  steadyLight(key: string, spec: SteadyLightSpec | null): void;
  spectral(blades: SpectralInstanceSpec[], arrows: SpectralInstanceSpec[]): void;
}

export type AbilityId =
  | 'nova'
  | 'meteor'
  | 'chain'
  | 'volley'
  | 'blades'
  | 'well'
  | 'spikes'
  | 'fire'
  | 'deluge';

export type SlottableId = Exclude<AbilityId, 'nova' | 'blades'>;

type MutableSteadyLightSpec = SteadyLightSpec & { color: [number, number, number] };

type VolleyRecord = CpuRecord<typeof VolleyArrow>;

type PooledSpectralInstance = CpuRecord<typeof SpectralInstance>;

export function createAbilities(deps: AbilityDeps) {
  const { input, sim, stats, loadout, emit, sfx, sfxLoop } = deps;
  const unlocked = stats.unlocked;

  const cd: Record<AbilityId, number> = {
    nova: 0,
    meteor: 0,
    chain: 0,
    volley: 0,
    blades: 0,
    well: 0,
    spikes: 0,
    fire: 0,
    deluge: 0,
  };
  const cdKeys = Object.keys(cd) as AbilityId[];

  const shock = { x: 0, z: 0, start: -100 };
  const meteor = {
    x: 0,
    z: 0,
    falling: false,
    fallT: 0,
    spin: 0,
    impactAt: -100,
    damageThisFrame: 0,
    impactX: 0,
    impactZ: 0,
    radiusThisFrame: METEOR.radius,
  };
  const pendingSmall: { x: number; z: number; delay: number; fallT: number; live: boolean }[] = [];
  const impactQueue: { x: number; z: number; damage: number; radius: number }[] = [];
  let chainStart = -100;
  const well = { x: 0, z: 0, start: -100, detonateThisFrame: 0, detonated: false };
  const spikes = { x: 0, z: 0, dx: 0, dz: 1, start: -100, lightMark: 0 };
  const fire = { x: 0, z: 0, start: -100 };
  const deluge = { x: 0, z: 0, dx: 0, dz: 1, start: -100, reach: 0, lightMark: 0, riptide: false };
  const flood = { zapStart: -100, zapDps: 0 };
  const wellHumOpts = { x: 0, z: 0, gain: 0, rate: 1 };
  const wellLightSpec: MutableSteadyLightSpec = {
    x: 0,
    y: 1.4,
    z: 0,
    color: [0, 0, 0],
    radius: 0,
  };
  const delugeLightSpec: SteadyLightSpec = {
    x: 0,
    y: 1.0,
    z: 0,
    color: [0.35, 0.7, 1.3],
    radius: 12,
  };
  const meteorLightSpec: SteadyLightSpec = { x: 0, y: 0, z: 0, color: [4.2, 1.6, 0.4], radius: 13 };
  let volleyArrows: VolleyRecord[] = [];
  const crescentWaves: {
    x: number;
    z: number;
    dx: number;
    dz: number;
    start: number;
    lightMark: number;
    thrust: boolean;
  }[] = [];
  let ultCharge = 0;

  function frontLightDue(fx: { lightMark: number }, front: number, interval: number) {
    if (front - fx.lightMark < interval) return false;
    fx.lightMark = front;
    return true;
  }

  function addCharge(amount: number) {
    const soften = 1 - ultCharge * SHOCK.chargeSoftening;
    ultCharge = Math.min(1, ultCharge + amount * stats.nova.chargeRate * soften);
  }

  function updateCrescents(player: Player, now: number) {
    if (player.attackThisFrame > 0 && stats.keystones.has('crescent')) {
      const thrust = player.strokeSign === 0;
      const dmg = stats.player.attackDamage * KEYSTONES.crescent.damageFrac;
      sim.castCrescent([player.x, player.z], [player.aimX, player.aimZ], now, dmg, thrust ? 1 : 0);
      crescentWaves.push({
        x: player.x,
        z: player.z,
        dx: player.aimX,
        dz: player.aimZ,
        start: now,
        lightMark: 2,
        thrust,
      });
    }
    for (let i = crescentWaves.length - 1; i >= 0; i--) {
      const w = crescentWaves[i];
      const cfg = w.thrust ? KEYSTONES.crescent.thrust : KEYSTONES.crescent;
      const age = now - w.start;
      if (age >= cfg.range / cfg.speed) {
        crescentWaves.splice(i, 1);
        continue;
      }
      const frontD = age * cfg.speed;
      const fx = w.x + w.dx * frontD;
      const fz = w.z + w.dz * frontD;
      emit(w.thrust ? spearTrail(fx, fz, w.dx, w.dz) : crescentTrail(fx, fz, w.dx, w.dz));
      if (frontD >= w.lightMark) {
        w.lightMark += 3;
        deps.light({
          x: fx,
          y: 0.9,
          z: fz,
          color: [1.3, 1.1, 0.55],
          radius: 4,
          life: 0.35,
        });
      }
    }
  }

  function refundCooldowns(seconds: number) {
    if (seconds <= 0) return;
    for (const k of cdKeys) {
      if (k === 'nova') continue;
      if (cd[k] > 0) cd[k] = Math.max(0, cd[k] - seconds);
    }
  }

  function castNova(player: Player, now: number) {
    ultCharge = 0;
    cd.nova = SHOCK.retriggerLock;
    shock.x = player.x;
    shock.z = player.z;
    shock.start = now;
    deps.shake(0.5);
    sfx('ult_nova');
    emit(novaFlash(player.x, player.z));
    deps.light({
      x: player.x,
      y: 1.2,
      z: player.z,
      color: [3.2, 2.1, 0.7],
      radius: 11,
      life: 0.5,
    });
    deps.light({
      x: shock.x,
      y: 0.8,
      z: shock.z,
      color: [1.5, 0.55, 0.12],
      radius: 9,
      life: 2.4,
    });
  }

  function castMeteor(player: Player, aim: { x: number; z: number }) {
    const p = clampCastPoint(player, aim, METEOR.castRange);
    meteor.x = p.x;
    meteor.z = p.z;
    meteor.falling = true;
    meteor.fallT = 0;
    cd.meteor = stats.meteor.cooldown;
    sfx('meteor_fall');

    if (stats.keystones.has('meteorShower')) {
      const shower = KEYSTONES.meteorShower;
      pendingSmall.length = 0;
      for (let i = 0; i < shower.count; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = shower.scatterRadius * (0.35 + 0.65 * Math.random());
        const sp = { x: meteor.x + Math.cos(a) * r, z: meteor.z + Math.sin(a) * r };
        clampToArena(sp, 1);
        pendingSmall.push({
          x: sp.x,
          z: sp.z,
          delay: shower.delayMin + Math.random() * shower.delaySpan,
          fallT: 0,
          live: true,
        });
      }
    }
  }

  function castWell(player: Player, aim: { x: number; z: number }, now: number) {
    const p = clampCastPoint(player, aim, WELL.castRange);
    well.x = p.x;
    well.z = p.z;
    well.start = now;
    cd.well = stats.well.cooldown;
    well.detonated = false;
    deps.shake(0.25);
  }

  function wellHum(ramp: number, unstable: number) {
    wellHumOpts.x = well.x;
    wellHumOpts.z = well.z;
    wellHumOpts.gain = Math.max(0.25, ramp) + unstable * 0.4;
    wellHumOpts.rate = 1 + unstable * 0.25;
    sfxLoop('well', 'well_loop', wellHumOpts);
  }

  function updateWell(now: number) {
    well.detonateThisFrame = 0;
    if (well.start < 0) return;
    const t = now - well.start;
    const single = stats.keystones.has('singularity');
    const sk = KEYSTONES.singularity;
    if (t < WELL.duration) {
      const ramp = Math.min(Math.min(t * 4, 1), (WELL.duration - t) * 2.5);
      const unstable = Math.max(0, 1 - (WELL.duration - t) / 0.7);
      emit(
        wellCore(well.x, well.z, Math.max(0.25, ramp) + unstable * 0.5, single ? sk.coreScale : 1),
      );
      emit(
        wellAccretion(well.x, well.z, single ? sk.accretionMult : 1, single ? sk.radiusBonus : 0),
      );
      if (single) {
        emit(singularityInfall(well.x, well.z, sk.infallRate));
      }
      wellHum(ramp, unstable);
      deps.shake(0.12 + unstable * (single ? 0.45 : 0.3));
      const glow = ramp + unstable * 1.6;
      const pulse = single ? 1 + (0.25 + unstable * 0.35) * Math.sin(now * 26) : 1;
      wellLightSpec.x = well.x;
      wellLightSpec.z = well.z;
      wellLightSpec.color[0] = 1.1 * glow * pulse;
      wellLightSpec.color[1] = 0.5 * glow * pulse;
      wellLightSpec.color[2] = 2.3 * glow * pulse;
      wellLightSpec.radius = (11 + unstable * 4) * (single ? 1.35 : 1);
      deps.steadyLight('well', wellLightSpec);
      return;
    }
    if (!well.detonated) {
      well.detonated = true;
      well.detonateThisFrame = stats.well.damage * (single ? sk.damageMult : 1);
      const burstScale = single ? sk.burstScale : 1;
      deps.steadyLight('well', null);
      sfxLoop('well', null);
      sfx('well_detonate', { x: well.x, z: well.z });
      deps.shake(0.7 * burstScale);
      deps.flash(0.25 * burstScale);
      emit(wellBurst(well.x, well.z, burstScale));
      deps.light({
        x: well.x,
        y: 1.5,
        z: well.z,
        color: [3.4 * burstScale, 1.6 * burstScale, 6.0 * burstScale],
        radius: 15 * burstScale,
        life: 0.6,
      });
      deps.light({
        x: well.x,
        y: 1.0,
        z: well.z,
        color: [0.9, 0.45, 1.7],
        radius: 10 * burstScale,
        life: 2.0 * burstScale,
      });
    }
    if (t > WELL.duration + 0.8) {
      well.start = -100;
      well.detonated = false;
    }
  }

  function castSpikes(player: Player, aim: { x: number; z: number }, now: number) {
    const dir = aimDir(player, aim);
    spikes.dx = dir.x;
    spikes.dz = dir.z;
    spikes.x = player.x + spikes.dx * 0.9;
    spikes.z = player.z + spikes.dz * 0.9;
    spikes.start = now;
    cd.spikes = stats.spikes.cooldown;
    spikes.lightMark = 0;
    deps.obstacles.spawnLine(spikes.x, spikes.z, spikes.dx, spikes.dz, now);
    deps.shake(0.45);
    sfx('spikes_erupt');
  }

  function updateSpikes(now: number) {
    if (spikes.start < 0) return;
    const t = now - spikes.start;
    if (t > SPIKES.duration) {
      spikes.start = -100;
      return;
    }
    const front = Math.min(t * SPIKES.speed, SPIKES.range);
    emit(frostMist(spikes.x, spikes.z, spikes.dx, spikes.dz, front));
    if (front < SPIKES.range) {
      const fx = spikes.x + spikes.dx * front;
      const fz = spikes.z + spikes.dz * front;
      emit(spikeRubble(fx, fz));
      deps.shake(0.22);
      if (frontLightDue(spikes, front, 2)) {
        deps.light({
          x: fx,
          y: 1.2,
          z: fz,
          color: [0.7, 1.5, 2.4],
          radius: 8,
          life: 0.55,
        });
      }
    }
  }

  function castFire(player: Player, aim: { x: number; z: number }, now: number) {
    const { x: nx, z: nz } = aimDir(player, aim);
    fire.x = player.x + nx * 1.6;
    fire.z = player.z + nz * 1.6;
    fire.start = now;
    cd.fire = stats.fire.cooldown;
    sim.igniteFire(fire.x, fire.z, nx, nz);
    emit(fireCone(player.x, player.z, nx, nz));
    deps.shake(0.3);
    sfx('fire_cast');
    deps.light({
      x: fire.x + nx * 2,
      y: 1.2,
      z: fire.z + nz * 2,
      color: [3.4, 1.5, 0.4],
      radius: 12,
      life: 0.5,
    });
  }

  function updateFire(now: number) {
    if (fire.start >= 0 && now - fire.start > FIRE.hazeTime) {
      fire.start = -100;
    }
  }

  function castDeluge(player: Player, aim: { x: number; z: number }, now: number) {
    const { x: nx, z: nz } = aimDir(player, aim);
    deluge.x = player.x + nx * 1.2;
    deluge.z = player.z + nz * 1.2;
    deluge.dx = nx;
    deluge.dz = nz;
    deluge.start = now;
    deluge.reach = WATER.coneRange * Math.sqrt(stats.deluge.surge);
    deluge.lightMark = 0;
    deluge.riptide = stats.keystones.has('undertow');
    cd.deluge = stats.deluge.cooldown;
    sim.surgeWater(deluge.x, deluge.z, nx, nz, stats.deluge.surge, deluge.riptide);
    sfx('water_cast');
    emit(delugeBurst(player.x, player.z, nx, nz));
    deps.shake(0.5);
    deps.light({
      x: deluge.x + nx * 2,
      y: 1.0,
      z: deluge.z + nz * 2,
      color: [0.5, 0.9, 1.6],
      radius: 10,
      life: 0.6,
    });
  }

  function updateDeluge(now: number) {
    if (deluge.start < 0) return;
    const t = now - deluge.start;
    const boreSpeed = WATER.surgeSpeed * 0.65;
    const front = t * boreSpeed;
    const runout = deluge.reach * 1.6;
    if (front < runout) {
      emit(delugeFront(deluge.x, deluge.z, deluge.dx, deluge.dz, front));
      deps.shake(0.1);
      if (frontLightDue(deluge, front, 3)) {
        deps.light({
          x: deluge.x + deluge.dx * front,
          y: 0.9,
          z: deluge.z + deluge.dz * front,
          color: [0.45, 0.85, 1.5],
          radius: 7,
          life: 0.5,
        });
      }
    }
    const riptideT = deluge.riptide ? KEYSTONES.undertow.riptideTime : 0;
    if (deluge.riptide && t < riptideT) {
      const mid = Math.min(front, runout) * 0.6;
      delugeLightSpec.x = deluge.x + deluge.dx * mid;
      delugeLightSpec.z = deluge.z + deluge.dz * mid;
      deps.steadyLight('deluge', delugeLightSpec);
    }
    if (t >= Math.max(runout / boreSpeed, riptideT)) {
      deps.steadyLight('deluge', null);
      deluge.start = -100;
    }
  }

  function castChain(player: Player, now: number) {
    cd.chain = stats.chain.cooldown;
    chainStart = now;
    sim.queueChain();
    sfx('chain_lightning');
    if (sim.waterActive()) {
      flood.zapStart = now;
      flood.zapDps = stats.chain.damage * WATER.zapDpsFrac;
      deps.shake(0.25);
      const mid = Math.min(deluge.reach, 6);
      deps.light({
        x: deluge.x + deluge.dx * mid * 0.6,
        y: 1.6,
        z: deluge.z + deluge.dz * mid * 0.6,
        color: [1.4, 2.6, 4.6],
        radius: 18,
        life: 0.8,
      });
    }
    deps.shake(0.2);
    deps.flash(0.55);
    deps.light({
      x: player.x,
      y: 9,
      z: player.z,
      color: [4.0, 4.8, 7.5],
      radius: 34,
      life: 0.45,
    });
    deps.light({
      x: player.x,
      y: 2.5,
      z: player.z,
      color: [1.2, 1.6, 3.0],
      radius: 14,
      life: 2.0,
    });
  }

  function castVolley(player: Player, aim: { x: number; z: number }, now: number) {
    cd.volley = stats.volley.cooldown;
    const baseA = Math.atan2(aim.x - player.x, aim.z - player.z);
    const spread = (VOLLEY.spreadDeg * Math.PI) / 180;
    const n = Math.min(MAX_VOLLEY, Math.max(1, Math.round(stats.volley.count)));
    volleyArrows = [];
    for (let i = 0; i < n; i++) {
      const a = baseA + (n > 1 ? (i / (n - 1) - 0.5) * spread : 0);
      volleyArrows.push({
        origin: [player.x, player.z],
        dir: [Math.sin(a), Math.cos(a)],
        start: now,
        damage: stats.volley.damage,
      });
    }
    sim.castVolley(volleyArrows);
    sfx('volley_loose');
    emit(volleyFlash(player.x, player.z, baseA, spread));
    deps.light({
      x: player.x,
      y: 1.3,
      z: player.z,
      color: [0.55, 1.5, 0.5],
      radius: 8,
      life: 0.35,
    });
  }

  const arrowInst: PooledSpectralInstance[] = [];
  const bladeInst: PooledSpectralInstance[] = [];
  const instPools: PooledSpectralInstance[][] = [[], []];
  function pooledInst(
    pool: PooledSpectralInstance[],
    list: PooledSpectralInstance[],
  ): PooledSpectralInstance {
    let inst = pool[list.length];
    if (!inst) {
      inst = { pos: [0, 0, 0], yaw: 0, scale: 1 };
      pool.push(inst);
    }
    list.push(inst);
    return inst;
  }

  function updateSpectralWeapons(player: Player, now: number) {
    const life = VOLLEY.range / VOLLEY.speed;
    const toxicWake = stats.keystones.has('toxicWake');
    const wakeLife = life + (toxicWake ? KEYSTONES.toxicWake.linger : 0);
    arrowInst.length = 0;
    if (volleyArrows.length > 0) {
      let anyLive = false;
      for (const v of volleyArrows) {
        const age = now - v.start;
        if (age < 0 || age >= wakeLife) continue;
        anyLive = true;
        const t = Math.min(age, life);
        const x = v.origin[0] + v.dir[0] * (t * VOLLEY.speed);
        const z = v.origin[1] + v.dir[1] * (t * VOLLEY.speed);
        if (age < life) {
          const inst = pooledInst(instPools[0], arrowInst);
          inst.pos[0] = x;
          inst.pos[1] = 1.0;
          inst.pos[2] = z;
          inst.yaw = Math.atan2(v.dir[0], v.dir[1]);
          inst.scale = 1;
          emit(arrowHead(x, z, v.dir[0], v.dir[1]));
        }
        if (toxicWake) emit(wakeBubbles(v.origin[0], v.origin[1], x, z));
      }
      if (!anyLive) volleyArrows.length = 0;
    }
    bladeInst.length = 0;
    const bladeCount = stats.bladeCount;
    if (bladeCount > 0 && player.alive) {
      for (let k = 0; k < bladeCount; k++) {
        const ang = bladeAngle(now, k, bladeCount);
        const inst = pooledInst(instPools[1], bladeInst);
        inst.pos[0] = player.x + Math.sin(ang) * BLADES.orbitRadius;
        inst.pos[1] = 0.95 + Math.sin(now * 3.1 + k * 2.4) * 0.14;
        inst.pos[2] = player.z + Math.cos(ang) * BLADES.orbitRadius;
        inst.yaw = ang - Math.PI / 2;
        inst.scale = 1 + 0.07 * Math.sin(now * 5.3 + k * 1.7);
      }
    }
    deps.spectral(bladeInst, arrowInst);
  }

  function updateMeteorFall(dt: number, now: number) {
    meteor.damageThisFrame = 0;
    if (meteor.falling) {
      meteor.fallT += dt;
      const s = Math.min(1, meteor.fallT / METEOR.fallTime);
      const ease = s * s;
      const x = meteor.x + METEOR.fallDriftX * (1 - ease);
      const y = METEOR.fallHeight * (1 - ease) + METEOR.impactY;
      const z = meteor.z + METEOR.fallDriftZ * (1 - ease);
      meteor.spin += dt * METEOR.spinRate;
      deps.moveMeteorMesh(x, y, z, meteor.spin);
      emit(meteorTrail(x, y, z));
      meteorLightSpec.x = x;
      meteorLightSpec.y = y;
      meteorLightSpec.z = z;
      deps.steadyLight('meteor', meteorLightSpec);

      if (s >= 1) {
        meteor.falling = false;
        meteor.impactAt = now;
        impactQueue.push({
          x: meteor.x,
          z: meteor.z,
          damage: stats.meteor.damage,
          radius: METEOR.radius,
        });
        sfx('meteor_impact', { x: meteor.x, z: meteor.z });
        deps.shake(0.9);
        deps.flash(0.3);
        deps.moveMeteorMesh(0, -100, 0, 0);
        deps.steadyLight('meteor', null);
        emit(meteorImpact(meteor.x, meteor.z));
        if (stats.keystones.has('meteorShower')) {
          sim.igniteAt(meteor.x, meteor.z, METEOR.igniteRadius, METEOR.igniteHeatFrac);
        }
        deps.light({
          x: meteor.x,
          y: 1.5,
          z: meteor.z,
          color: [9.0, 3.4, 0.8],
          radius: 20,
          life: 1.1,
        });
        deps.light({
          x: meteor.x,
          y: 0.8,
          z: meteor.z,
          color: [2.8, 0.95, 0.2],
          radius: 13,
          life: 5,
        });
      }
    }

    const shower = KEYSTONES.meteorShower;
    const smallFallTime = METEOR.fallTime * shower.fallTimeFrac;
    let anyFalling = false;
    for (const sm of pendingSmall) {
      if (!sm.live) continue;
      if (sm.delay > 0) {
        sm.delay -= dt;
        continue;
      }
      anyFalling = true;
      sm.fallT += dt;
      const s = Math.min(1, sm.fallT / smallFallTime);
      const ease = s * s;
      const x = sm.x + METEOR.fallDriftX * shower.radiusFrac * (1 - ease);
      const y = METEOR.fallHeight * (1 - ease) + METEOR.impactY;
      const z = sm.z + METEOR.fallDriftZ * shower.radiusFrac * (1 - ease);
      emit(meteorTrail(x, y, z, shower.radiusFrac));
      emit(meteorTelegraph(sm.x, sm.z));
      if (s >= 1) {
        sm.live = false;
        impactQueue.push({
          x: sm.x,
          z: sm.z,
          damage: stats.meteor.damage * shower.damageFrac,
          radius: METEOR.radius * shower.radiusFrac,
        });
        sfx('meteor_impact', { x: sm.x, z: sm.z, gain: 0.55 });
        deps.shake(0.35);
        emit(meteorImpact(sm.x, sm.z, shower.radiusFrac));
        if (stats.keystones.has('meteorShower')) {
          sim.igniteAt(sm.x, sm.z, METEOR.igniteRadius * shower.radiusFrac, METEOR.igniteHeatFrac);
        }
        deps.light({
          x: sm.x,
          y: 1.2,
          z: sm.z,
          color: [4.5, 1.7, 0.4],
          radius: 8,
          life: 0.6,
        });
      }
    }
    if (anyFalling) deps.shake(0.05);

    const ev = impactQueue.shift();
    if (ev) {
      meteor.impactX = ev.x;
      meteor.impactZ = ev.z;
      meteor.damageThisFrame = ev.damage;
      meteor.radiusThisFrame = ev.radius;
    }
  }

  const casts: Record<
    SlottableId,
    (player: Player, aim: { x: number; z: number }, now: number) => void
  > = {
    meteor: (p, aim) => castMeteor(p, aim),
    chain: (p, _aim, now) => castChain(p, now),
    volley: (p, aim, now) => castVolley(p, aim, now),
    well: (p, aim, now) => castWell(p, aim, now),
    spikes: (p, aim, now) => castSpikes(p, aim, now),
    fire: (p, aim, now) => castFire(p, aim, now),
    deluge: (p, aim, now) => castDeluge(p, aim, now),
  };
  const canCast: Record<SlottableId, () => boolean> = {
    meteor: () => unlocked.has('meteor') && cd.meteor <= 0 && !meteor.falling,
    chain: () => unlocked.has('chain') && cd.chain <= 0,
    volley: () => unlocked.has('volley') && cd.volley <= 0,
    well: () => unlocked.has('well') && cd.well <= 0 && well.start < 0,
    spikes: () => unlocked.has('spikes') && cd.spikes <= 0,
    fire: () => unlocked.has('fire') && cd.fire <= 0,
    deluge: () => unlocked.has('deluge') && cd.deluge <= 0,
  };

  return {
    shock,
    meteor,
    well,
    spikes,
    fire,
    deluge,
    flood,
    get chainStart() {
      return chainStart;
    },
    get ultCharge() {
      return ultCharge;
    },
    addCharge,
    refundCooldowns,
    setUltCharge(value: number) {
      ultCharge = saturate(value);
    },
    slotReady(i: number): boolean {
      const id = loadout.slots[i];
      return id !== null && canCast[id]();
    },
    slotCooldownFrac(i: number): number {
      const id = loadout.slots[i];
      if (id === null || !unlocked.has(id)) return 0;
      const total = stats[id].cooldown;
      if (total <= 0) return 0;
      return saturate(cd[id] / total);
    },
    update(dt: number, now: number, player: Player, aim: { x: number; z: number }) {
      for (const id of cdKeys) cd[id] -= dt;

      if (player.alive) {
        addCharge(SHOCK.chargeTrickle * dt);
        if (input.consume('ult')) {
          if (ultCharge >= 1 && cd.nova <= 0) {
            castNova(player, now);
            player.playCast(CLIP.RAISE, PLAYER_ANIM.raiseDur);
          } else {
            sfx('ui_denied');
          }
        }
        for (let i = 0; i < loadout.slots.length; i++) {
          if (!input.consume(`slot${i}` as SlotAction)) continue;
          const id = loadout.slots[i];
          if (id && unlocked.has(id) && canCast[id]()) {
            casts[id](player, aim, now);
            if (id === 'meteor') player.playCast(CLIP.RAISE, PLAYER_ANIM.raiseDur);
            else player.playCast(CLIP.CAST, PLAYER_ANIM.castDur);
          } else if (id) {
            sfx('ui_denied');
          }
        }
      }

      updateWell(now);
      updateSpikes(now);
      updateFire(now);
      updateDeluge(now);
      updateMeteorFall(dt, now);
      updateCrescents(player, now);
      updateSpectralWeapons(player, now);

      if (shock.start >= 0 && now - shock.start > SHOCK.crackDuration) {
        shock.start = -100;
      }
      if (meteor.impactAt >= 0 && now - meteor.impactAt > METEOR.craterDuration) {
        meteor.impactAt = -100;
      }
    },
  };
}

export type Abilities = ReturnType<typeof createAbilities>;
