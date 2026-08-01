import { d } from 'typegpu';
import type { BakedClipMeta } from '../assets/anim.ts';
import type { Sfx } from '../audio/contract.ts';
import { CLIP } from '../core/animation.ts';
import { normalize2, saturate } from '../core/mathx.ts';
import {
  ARROW,
  BOSS,
  ELITES,
  ENEMY_TYPES,
  isBossWave,
  MAGEBOLT,
  MAX_ENEMIES,
  NECRO_GLOW,
  PLAYER,
  READBACK,
  SPAWN_RADIUS,
  STRIKE,
  TELEGRAPH,
  waveComposition,
  WAVES,
} from '../config.ts';
import {
  ACTOR_FLAGS,
  type ActorBuffer,
  type ActorRecord,
  ActorSnap,
  makeActor,
  STATE,
} from '../core/schemas.ts';
import type { LightSpec, SteadyLightSpec } from '../renderer/env.ts';
import type { ParticleSpec } from '../renderer/particles.ts';
import {
  boneBurst,
  slamImpact,
  slamTelegraph,
  spawnDirt,
  stompDust,
  summonRaise,
} from './effects.ts';
import type { Hud } from './hud.ts';
import type { Player } from './player.ts';
import type { ActorReadback } from './readback.ts';
import { TG_KIND, type Telegraphs } from './telegraphs.ts';

type MutableSteadyLightSpec = SteadyLightSpec & { color: [number, number, number] };

export interface WaveDeps {
  enemyBuf: ActorBuffer;
  readback: ActorReadback;
  clips: BakedClipMeta[];
  player: Player;
  hud: Hud;
  emit(specs: ParticleSpec[]): void;
  shake(amp: number): void;
  sfx: Sfx;
  light(spec: LightSpec): void;
  steadyLight(key: string, spec: SteadyLightSpec | null): void;
  nightFactor(): number;
  onKill(typeIdx: number, x: number, z: number, elite: boolean): void;
  onSlam?(x: number, z: number): void;
  onCheckpoint?(nextWave: number, kills: number): void;
  lobOrb(x: number, z: number, tx: number, tz: number, now: number, damage: number): void;
  fireArrow(x: number, z: number, now: number, damage: number): void;
  throwBoulder(ox: number, oz: number, tx: number, tz: number, now: number, damage: number): void;
  telegraph: Telegraphs;
  enemyDamageMul: number;
  enemyHpMul: number;
  setEnemyCounts(counts: readonly number[]): void;
  startWave?: number;
  kills?: number;
}

export function createWaves(deps: WaveDeps) {
  const { enemyBuf, player, hud, readback } = deps;

  const stride = d.sizeOf(ActorSnap) / 4;
  const OFF = {
    posX: 0,
    posY: 1,
    heading: d.memoryLayoutOf(ActorSnap, (s) => s.heading).offset / 4,
    state: d.memoryLayoutOf(ActorSnap, (s) => s.state).offset / 4,
    flags: d.memoryLayoutOf(ActorSnap, (s) => s.flags).offset / 4,
    hp: d.memoryLayoutOf(ActorSnap, (s) => s.hp).offset / 4,
    stun: d.memoryLayoutOf(ActorSnap, (s) => s.stun).offset / 4,
  };

  const splitIdx = ENEMY_TYPES.map((et) =>
    et.splitInto ? ENEMY_TYPES.findIndex((o) => o.name === et.splitInto?.type) : -1,
  );
  const summonIdx = ENEMY_TYPES.map((et) =>
    et.summons ? ENEMY_TYPES.findIndex((o) => o.name === et.summons?.type) : -1,
  );

  const STRIKE_CLIPS = {
    punch: CLIP.EPUNCH,
    chop: CLIP.ECHOP,
    smash: CLIP.ESMASH,
    stab: CLIP.ESTAB,
    slice: CLIP.ESLICE,
  } as const;
  const strikeInfo = ENEMY_TYPES.map((et) => {
    if (!et.strike) return null;
    const clip = STRIKE_CLIPS[et.strike.clip];
    const hold = et.strike.windup + STRIKE.followThrough;
    const dur = deps.clips[clip].duration;
    const impact = STRIKE.impact[et.strike.clip];
    const lunge = et.strike.lunge ?? 0;
    const nearPatch = {
      animClip: clip,
      animTime: 0,
      attackT: hold,
      attackRate: (dur * impact) / et.strike.windup,
      recoverRate: (dur * (1 - impact)) / STRIKE.followThrough,
      windupT: et.strike.windup,
      dashT: 0,
      dashSpeed: 0,
    };
    const patch =
      lunge > 0
        ? { ...nearPatch, dashT: et.strike.windup, dashSpeed: lunge / et.strike.windup }
        : nearPatch;
    const halfArc = ((et.strike.arc ?? 360) / 2) * (Math.PI / 180);
    const arcCos = Math.cos(halfArc);
    const drawRadius = et.strike.range + STRIKE.hitSlack * TELEGRAPH.showSlackFrac;
    return { ...et.strike, clip, hold, patch, nearPatch, arcCos, halfArc, drawRadius };
  });
  const bashInfo = ENEMY_TYPES.map((et) => {
    if (!et.bash) return null;
    const dur = deps.clips[CLIP.EBASH].duration;
    return {
      ...et.bash,
      patch: {
        animClip: CLIP.EBASH,
        animTime: 0,
        attackT: et.bash.windup + STRIKE.followThrough,
        attackRate: (dur * STRIKE.impact.bash) / et.bash.windup,
        recoverRate: (dur * (1 - STRIKE.impact.bash)) / STRIKE.followThrough,
        windupT: et.bash.windup,
        dashT: et.bash.windup,
        dashSpeed: et.bash.lunge / et.bash.windup,
      },
    };
  });
  const slamInfo = BOSS.phases.windupMul.map((mul) => {
    const windup = BOSS.slam.windup * mul;
    const dur = deps.clips[CLIP.ESMASH].duration;
    return {
      windup,
      patch: {
        animClip: CLIP.ESMASH,
        animTime: 0,
        attackT: windup + BOSS.slam.followThrough,
        attackRate: (dur * STRIKE.impact.smash) / windup,
        recoverRate: (dur * (1 - STRIKE.impact.smash)) / BOSS.slam.followThrough,
        windupT: windup,
      },
    };
  });
  const castHold = MAGEBOLT.castWindup + STRIKE.followThrough;
  const castRate = deps.clips[CLIP.ECAST].duration / castHold;
  const castPatch = {
    animClip: CLIP.ECAST,
    animTime: 0,
    attackT: castHold,
    attackRate: castRate,
    recoverRate: castRate,
  };
  const shootDur = deps.clips[CLIP.ESHOOT].duration;
  const shootPatch = {
    animClip: CLIP.ESHOOT,
    animTime: 0,
    attackT: ARROW.windup + STRIKE.followThrough,
    attackRate: (shootDur * STRIKE.impact.shoot) / ARROW.windup,
    recoverRate: (shootDur * (1 - STRIKE.impact.shoot)) / STRIKE.followThrough,
    windupT: ARROW.windup,
  };
  const rangedInfo = ENEMY_TYPES.map((et) => {
    if (et.holdRange === undefined || et.summons) return null;
    return et.projectile === 'arrow'
      ? {
          windup: ARROW.windup,
          fireRange: ARROW.fireRange,
          cooldown: ARROW.cooldown,
          damage: ARROW.damage,
          patch: shootPatch,
          arrow: true,
        }
      : {
          windup: MAGEBOLT.castWindup,
          fireRange: MAGEBOLT.fireRange,
          cooldown: MAGEBOLT.cooldown,
          damage: MAGEBOLT.damage,
          patch: castPatch,
          arrow: false,
        };
  });
  const raisePatch = ENEMY_TYPES.map((et) => {
    if (!et.summons) return null;
    const hold = et.summons.windup + et.summons.recover;
    const rate = deps.clips[CLIP.ERAISE].duration / hold;
    return {
      animClip: CLIP.ERAISE,
      animTime: 0,
      attackT: hold,
      attackRate: rate,
      recoverRate: rate,
    };
  });
  let strikePatch: Record<
    number,
    {
      animClip: number;
      animTime: number;
      attackT: number;
      attackRate: number;
      recoverRate: number;
      windupT?: number;
      heading?: number;
      dashT?: number;
      dashSpeed?: number;
    }
  > = {};
  let strikePatchCount = 0;

  const deathDur = deps.clips[CLIP.DEATH].duration;

  const lastState = new Uint8Array(MAX_ENEMIES);
  const deathSeenAt = new Float32Array(MAX_ENEMIES).fill(-100);
  const spawnLockUntil = new Float32Array(MAX_ENEMIES).fill(-100);
  const spawnedAt = new Float32Array(MAX_ENEMIES).fill(-100);
  const atkCd = new Float32Array(MAX_ENEMIES);
  const attackAt = new Float32Array(MAX_ENEMIES);
  const stepAt = new Float32Array(MAX_ENEMIES);
  const spawnMaxHp = new Float32Array(MAX_ENEMIES).fill(1);
  const hiSlot = Int32Array.from(ENEMY_TYPES, (et) => et.slotStart - 1);
  const countsScratch = Array.from({ length: ENEMY_TYPES.length }, () => 0);

  let censusDt = 0;
  let censusSeenId = -1;

  let spawnPatch: Record<number, ActorRecord> = {};
  let spawnPatchCount = 0;
  let spawnSfxPlayed = false;

  function pushCounts() {
    for (let t = 0; t < ENEMY_TYPES.length; t++) {
      countsScratch[t] = Math.max(0, hiSlot[t] - ENEMY_TYPES[t].slotStart + 1);
    }
    deps.setEnemyCounts(countsScratch);
    readback.setOccupiedHi(hiSlot);
  }

  const wave = {
    n: Math.max(0, (deps.startWave ?? 1) - 1),
    queue: [] as number[],
    burstTimer: 0,
    intermission: WAVES.pregameDelay,
    kills: deps.kills ?? 0,
    aliveCount: 0,
    bossActive: false,
    clearTimer: 0,
  };
  hud.setWave(Math.max(1, deps.startWave ?? 1));

  function buildWaveQueue(n: number) {
    const q: number[] = [];
    const bosses: number[] = [];
    for (const [type, count] of waveComposition(n)) {
      for (let i = 0; i < count; i++) (ENEMY_TYPES[type].boss ? bosses : q).push(type);
    }
    for (let i = q.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [q[i], q[j]] = [q[j], q[i]];
    }
    return [...bosses, ...q];
  }

  function trySpawn(typeIdx: number, angle: number, now: number, atX?: number, atZ?: number) {
    const et = ENEMY_TYPES[typeIdx];
    for (let slot = et.slotStart; slot < et.slotEnd; slot++) {
      const st = lastState[slot];
      const freeCorpse = st === STATE.DYING && now - deathSeenAt[slot] > deathDur + 3;
      if (now < spawnLockUntil[slot] || (st !== STATE.DEAD && !freeCorpse)) continue;

      if (slot > hiSlot[typeIdx]) hiSlot[typeIdx] = slot;
      spawnLockUntil[slot] = now + 2.5;
      spawnedAt[slot] = now;
      lastState[slot] = STATE.SPAWNING;
      if (et.boss) bossBrains.delete(slot);
      const elite = !et.boss && wave.n >= ELITES.fromWave && Math.random() < ELITES.chance(wave.n);
      atkCd[slot] = et.boss
        ? 1.2
        : et.summons
          ? et.summons.cooldown * (0.2 + Math.random() * 0.2)
          : et.strike
            ? et.strike.cooldown * (0.25 + Math.random() * 0.35)
            : (rangedInfo[typeIdx]?.cooldown ?? MAGEBOLT.cooldown) * (0.5 + Math.random());
      attackAt[slot] = 0;
      stepAt[slot] = now;
      armedMove[slot] = 0;
      bashReadyAt[slot] = et.bash ? now + et.bash.cooldown * (0.2 + Math.random() * 0.5) : 0;
      const jitter = (Math.random() - 0.5) * 0.5;
      const r = SPAWN_RADIUS + (Math.random() - 0.5) * 3;
      const x = atX ?? Math.cos(angle + jitter) * r;
      const z = atZ ?? Math.sin(angle + jitter) * r;
      const hp = et.hp * WAVES.hpScale(wave.n) * deps.enemyHpMul * (elite ? ELITES.hpMult : 1);
      spawnMaxHp[slot] = hp;
      spawnPatch[slot] = makeActor({
        pos: [x, z],
        heading: Math.atan2(player.x - x, player.z - z),
        hp,
        state: STATE.SPAWNING,
        typeId: typeIdx,
        animClip: CLIP.SPAWN,
        radius: et.radius * (elite ? ELITES.radiusMult : 1),
        scale: (et.scale ?? 1) * (elite ? ELITES.scale : 1),
        flags: (elite ? ACTOR_FLAGS.ELITE : 0) | (et.boss ? ACTOR_FLAGS.BOSS : 0),
      });
      spawnPatchCount++;
      deps.emit(spawnDirt(x, z));
      if (!spawnSfxPlayed) {
        spawnSfxPlayed = true;
        deps.sfx('skeleton_spawn', { x, z });
      }
      if (et.boss) {
        hud.banner(BOSS.name);
        deps.sfx('boss_spawn', { x, z });
        deps.shake(0.3);
      }
      return true;
    }
    return false;
  }

  const pendingSpawns: { typeIdx: number; x: number; z: number }[] = [];

  const glowSlots = new Map<number, { key: string; spec: MutableSteadyLightSpec; lit: boolean }>();
  function slotGlow(
    slot: number,
    on: boolean,
    x: number,
    z: number,
    y: number,
    color: readonly [number, number, number],
    gain: number,
    radius: number,
  ) {
    let g = glowSlots.get(slot);
    if (!g) {
      if (!on) return;
      g = {
        key: `glow${slot}`,
        spec: { x: 0, y: 0, z: 0, color: [0, 0, 0], radius: 0 },
        lit: false,
      };
      glowSlots.set(slot, g);
    }
    if (on) {
      g.spec.x = x;
      g.spec.y = y;
      g.spec.z = z;
      g.spec.color[0] = color[0] * gain;
      g.spec.color[1] = color[1] * gain;
      g.spec.color[2] = color[2] * gain;
      g.spec.radius = radius;
      if (!g.lit) deps.steadyLight(g.key, g.spec);
      g.lit = true;
    } else if (g.lit) {
      deps.steadyLight(g.key, null);
      g.lit = false;
    }
  }

  function registerKill(
    t: number,
    slot: number,
    kx: number,
    kz: number,
    elite: boolean,
    now: number,
  ) {
    const type = ENEMY_TYPES[t];
    wave.kills++;
    deathSeenAt[slot] = now;
    deps.telegraph.clear(slot);
    if (type.boss) bossBrains.delete(slot);
    deps.onKill(t, kx, kz, elite);
    const split = type.splitInto;
    if (split && splitIdx[t] >= 0) {
      deps.emit(boneBurst(kx, kz));
      deps.sfx('amalgam_split', { x: kx, z: kz });
      const baseA = Math.random() * Math.PI * 2;
      for (let c = 0; c < split.count; c++) {
        const ca = baseA + (c / split.count) * Math.PI * 2;
        pendingSpawns.push({
          typeIdx: splitIdx[t],
          x: kx + Math.cos(ca) * 0.7,
          z: kz + Math.sin(ca) * 0.7,
        });
      }
    }
    if (type.boss) hud.banner('THE GOLEM FALLS');
  }

  let dmgMul = 1;

  interface AttackKind {
    cancelable: boolean;
    onArm(
      slot: number,
      t: number,
      ex: number,
      ez: number,
      now: number,
      heading: number,
      distSq: number,
    ): number | undefined;
    onFire(
      slot: number,
      t: number,
      ex: number,
      ez: number,
      now: number,
      distSq: number,
      heading: number,
    ): void;
    onWindup?(slot: number, t: number, ex: number, ez: number, now: number, heading: number): void;
  }

  function attackCycle(
    k: AttackKind,
    slot: number,
    t: number,
    dt: number,
    now: number,
    ex: number,
    ez: number,
    distSq: number,
    stun: number,
    windup: number,
    range: number,
    heading: number,
  ) {
    atkCd[slot] -= dt;
    if (attackAt[slot] > 0) {
      k.onWindup?.(slot, t, ex, ez, now, heading);
      if (now >= attackAt[slot]) {
        attackAt[slot] = 0;
        if (k.cancelable && stun > STRIKE.cancelStun) {
          atkCd[slot] = STRIKE.cancelRetry;
          deps.telegraph.clear(slot);
        } else {
          k.onFire(slot, t, ex, ez, now, distSq, heading);
        }
      }
    } else if (atkCd[slot] <= 0 && distSq < range * range) {
      attackAt[slot] = now + (k.onArm(slot, t, ex, ez, now, heading, distSq) ?? windup);
    }
  }

  const armedMove = new Uint8Array(MAX_ENEMIES);
  const bashReadyAt = new Float64Array(MAX_ENEMIES);
  const bashHit = new Uint8Array(MAX_ENEMIES);
  const bashPX = new Float32Array(MAX_ENEMIES);
  const bashPZ = new Float32Array(MAX_ENEMIES);

  function bashSweep(slot: number, t: number, ex: number, ez: number) {
    const bash = bashInfo[t];
    if (!bash) return;
    if (bashHit[slot] === 0 && player.alive && player.invulnT <= 0) {
      const reach = bash.width + PLAYER.radius;
      if (segDistSq(bashPX[slot], bashPZ[slot], ex, ez) < reach * reach) {
        bashHit[slot] = 1;
        player.damage(bash.damage * dmgMul);
        hud.heat(bash.damage * dmgMul * STRIKE.heatPerDamage);
        deps.shake(STRIKE.shake);
      }
    }
    bashPX[slot] = ex;
    bashPZ[slot] = ez;
  }

  const meleeKind: AttackKind = {
    cancelable: true,
    onArm(slot, t, ex, ez, now, heading, distSq) {
      const strike = strikeInfo[t];
      if (!strike) return undefined;
      const bash = bashInfo[t];
      if (bash && now >= bashReadyAt[slot] && distSq > strike.range * strike.range) {
        armedMove[slot] = 2;
        bashHit[slot] = 0;
        bashPX[slot] = ex;
        bashPZ[slot] = ez;
        strikePatch[slot] = bash.patch;
        strikePatchCount++;
        deps.telegraph.arm(
          slot,
          TG_KIND.line,
          ex,
          ez,
          Math.sin(heading),
          Math.cos(heading),
          bash.lunge + 1,
          bash.width,
          now,
          now + bash.windup,
        );
        deps.sfx('sword_swing', {
          x: ex,
          z: ez,
          gain: TELEGRAPH.whooshGain,
          rate: TELEGRAPH.whooshRate,
        });
        return bash.windup;
      }
      const pounce = (strike.lunge ?? 0) > 0 && distSq > strike.range * strike.range;
      armedMove[slot] = pounce ? 1 : 0;
      strikePatch[slot] = pounce ? strike.patch : strike.nearPatch;
      strikePatchCount++;
      const lunge = pounce ? (strike.lunge ?? 0) : 0;
      deps.telegraph.arm(
        slot,
        TG_KIND.arc,
        ex + Math.sin(heading) * lunge,
        ez + Math.cos(heading) * lunge,
        Math.sin(heading),
        Math.cos(heading),
        strike.drawRadius,
        strike.halfArc,
        now,
        now + strike.windup,
      );
      if (strike.windup >= TELEGRAPH.whooshMinWindup) {
        deps.sfx('sword_swing', {
          x: ex,
          z: ez,
          gain: TELEGRAPH.whooshGain,
          rate: TELEGRAPH.whooshRate,
        });
      }
      return undefined;
    },
    onWindup(slot, t, ex, ez, now, heading) {
      const strike = strikeInfo[t];
      if (!strike) return;
      if (armedMove[slot] === 2) {
        bashSweep(slot, t, ex, ez);
        return;
      }
      const remaining =
        armedMove[slot] === 1 && strike.lunge && attackAt[slot] > now
          ? Math.min(strike.lunge, strike.patch.dashSpeed * (attackAt[slot] - now))
          : 0;
      deps.telegraph.move(
        slot,
        ex + Math.sin(heading) * remaining,
        ez + Math.cos(heading) * remaining,
        Math.sin(heading),
        Math.cos(heading),
      );
    },
    onFire(slot, t, ex, ez, now, distSq, heading) {
      const strike = strikeInfo[t];
      if (!strike) return;
      if (armedMove[slot] === 2) {
        const bash = bashInfo[t];
        armedMove[slot] = 0;
        if (!bash) return;
        bashSweep(slot, t, ex, ez);
        atkCd[slot] = bash.recover;
        bashReadyAt[slot] = now + bash.cooldown;
        return;
      }
      atkCd[slot] = strike.cooldown;
      const reach = strike.range + STRIKE.hitSlack;
      if (distSq >= reach * reach || player.invulnT > 0) return;
      const dx = player.x - ex;
      const dz = player.z - ez;
      const fdot = Math.sin(heading) * dx + Math.cos(heading) * dz;
      if (fdot < Math.sqrt(distSq) * strike.arcCos) return;
      player.damage(strike.damage * dmgMul);
      hud.heat(strike.damage * dmgMul * STRIKE.heatPerDamage);
      deps.shake(STRIKE.shake);
    },
  };

  const rangedKind: AttackKind = {
    cancelable: true,
    onArm(slot, t, ex, ez, now, heading) {
      const info = rangedInfo[t];
      if (!info) return;
      atkCd[slot] = info.cooldown * (0.85 + Math.random() * 0.3);
      if (info.arrow) {
        deps.sfx('magebolt_cast', { x: ex, z: ez, rate: 0.7, gain: 0.45 });
      } else {
        deps.sfx('magebolt_cast', { x: ex, z: ez });
      }
      strikePatch[slot] = info.patch;
      strikePatchCount++;
      if (info.arrow) {
        deps.telegraph.arm(
          slot,
          TG_KIND.line,
          ex,
          ez,
          Math.sin(heading),
          Math.cos(heading),
          ARROW.telegraphLen,
          ARROW.telegraphWidth,
          now,
          now + info.windup,
        );
      }
    },
    onWindup(slot, t, ex, ez, _now, heading) {
      if (rangedInfo[t]?.arrow) {
        deps.telegraph.move(slot, ex, ez, Math.sin(heading), Math.cos(heading));
      }
    },
    onFire(_slot, t, ex, ez, now) {
      const info = rangedInfo[t];
      if (!info) return;
      if (info.arrow) {
        deps.fireArrow(ex, ez, now, info.damage * dmgMul);
      } else {
        deps.lobOrb(ex, ez, player.x, player.z, now, info.damage * dmgMul);
      }
    },
  };

  const summonKind: AttackKind = {
    cancelable: true,
    onArm(slot, t) {
      const s = ENEMY_TYPES[t].summons;
      const raise = raisePatch[t];
      if (!s || !raise) return;
      atkCd[slot] = s.cooldown * (0.9 + Math.random() * 0.2);
      strikePatch[slot] = raise;
      strikePatchCount++;
    },
    onFire(_slot, t, ex, ez) {
      const s = ENEMY_TYPES[t].summons;
      if (!s) return;
      deps.emit(boneBurst(ex, ez));
      deps.emit(summonRaise(ex, ez));
      deps.light({
        x: ex,
        y: NECRO_GLOW.summonLight.height,
        z: ez,
        color: NECRO_GLOW.summonLight.color,
        radius: NECRO_GLOW.summonLight.radius,
        life: NECRO_GLOW.summonLight.life,
      });
      const baseA = Math.random() * Math.PI * 2;
      for (let c = 0; c < s.count; c++) {
        const ca = baseA + (c / s.count) * Math.PI * 2;
        pendingSpawns.push({
          typeIdx: summonIdx[t],
          x: ex + Math.cos(ca) * 1.2,
          z: ez + Math.sin(ca) * 1.2,
        });
      }
    },
  };

  const BS = { IDLE: 0, SLAM: 1, CHARGE_WIND: 2, CHARGING: 3, STAGGER: 4, THROW: 5, ROAR: 6 };
  interface BossBrain {
    state: number;
    until: number;
    phase: number;
    chargesLeft: number;
    throwsLeft: number;
    nextThrowAt: number;
    hitDone: boolean;
    px: number;
    pz: number;
    dirX: number;
    dirZ: number;
    chargeLen: number;
    patch: {
      animClip: number;
      animTime: number;
      attackT: number;
      attackRate: number;
      recoverRate: number;
      windupT: number;
      heading: number;
      dashT: number;
      dashSpeed: number;
    };
  }
  const bossBrains = new Map<number, BossBrain>();
  const makeBrain = (): BossBrain => ({
    state: BS.IDLE,
    until: 0,
    phase: 0,
    chargesLeft: 0,
    throwsLeft: 0,
    nextThrowAt: 0,
    hitDone: false,
    px: 0,
    pz: 0,
    dirX: 0,
    dirZ: 1,
    chargeLen: 0,
    patch: {
      animClip: CLIP.IDLE,
      animTime: 0,
      attackT: 0,
      attackRate: 1,
      recoverRate: 1,
      windupT: 0,
      heading: 0,
      dashT: 0,
      dashSpeed: 0,
    },
  });

  function segDistSq(ax: number, az: number, bx: number, bz: number) {
    const abx = bx - ax;
    const abz = bz - az;
    const l2 = abx * abx + abz * abz;
    const t = l2 > 1e-6 ? saturate(((player.x - ax) * abx + (player.z - az) * abz) / l2) : 0;
    const dx = player.x - (ax + abx * t);
    const dz = player.z - (az + abz * t);
    return dx * dx + dz * dz;
  }

  function startChargeWind(br: BossBrain, slot: number, ex: number, ez: number, now: number) {
    const mul = BOSS.phases.windupMul[br.phase];
    const windup =
      (br.chargesLeft < BOSS.phases.chargeChain[br.phase]
        ? BOSS.charge.chainWindup
        : BOSS.charge.windup) * mul;
    const dx = player.x - ex;
    const dz = player.z - ez;
    const [nx, nz, len] = normalize2(dx, dz);
    br.dirX = len > 1e-3 ? nx : 0;
    br.dirZ = len > 1e-3 ? nz : 1;
    br.chargeLen = Math.min(len, BOSS.charge.maxRange) + BOSS.charge.overshoot;
    br.state = BS.CHARGE_WIND;
    br.until = now + windup;
    const p = br.patch;
    p.animClip = CLIP.ESMASH;
    p.animTime = 0;
    p.attackT = windup + 0.3;
    p.attackRate = (deps.clips[CLIP.ESMASH].duration * BOSS.charge.windupClipFrac) / windup;
    p.recoverRate = 0;
    p.windupT = windup;
    p.heading = Math.atan2(br.dirX, br.dirZ);
    p.dashT = 0;
    p.dashSpeed = 0;
    strikePatch[slot] = p;
    strikePatchCount++;
    deps.sfx('boss_slam_windup', { x: ex, z: ez, rate: 1.2 });
    deps.telegraph.arm(
      slot,
      TG_KIND.line,
      ex,
      ez,
      br.dirX,
      br.dirZ,
      br.chargeLen,
      BOSS.charge.width,
      now,
      br.until,
    );
  }

  function bossThink(
    br: BossBrain,
    slot: number,
    dt: number,
    now: number,
    ex: number,
    ez: number,
    distSq: number,
    hpFrac: number,
  ) {
    const PH = BOSS.phases;
    const targetPhase = hpFrac < PH.thresholds[1] ? 2 : hpFrac < PH.thresholds[0] ? 1 : 0;
    atkCd[slot] -= dt;
    const p = br.patch;

    if (br.state === BS.IDLE) {
      if (targetPhase > br.phase) {
        br.phase = targetPhase;
        br.state = BS.ROAR;
        br.until = now + PH.transition.holdT;
        p.animClip = CLIP.ERAISE;
        p.animTime = 0;
        p.attackT = PH.transition.holdT + 0.2;
        p.attackRate = deps.clips[CLIP.ERAISE].duration / PH.transition.holdT;
        p.recoverRate = p.attackRate;
        p.windupT = 0;
        p.heading = Math.atan2(player.x - ex, player.z - ez);
        p.dashT = 0;
        p.dashSpeed = 0;
        strikePatch[slot] = p;
        strikePatchCount++;
        deps.emit(boneBurst(ex, ez));
        deps.shake(PH.transition.shake);
        deps.sfx('boss_spawn', { x: ex, z: ez, gain: 0.55, rate: 1.15 });
        deps.light({
          x: ex,
          y: BOSS.aura.lightHeight,
          z: ez,
          color: BOSS.aura.lightColor,
          radius: BOSS.aura.lightRadius,
          life: PH.transition.holdT,
        });
        return;
      }
      if (atkCd[slot] > 0) return;
      const dist = Math.sqrt(distSq);
      if (dist < BOSS.slam.range) {
        const info = slamInfo[br.phase];
        br.state = BS.SLAM;
        br.until = now + info.windup;
        strikePatch[slot] = info.patch;
        strikePatchCount++;
        deps.sfx('boss_slam_windup', { x: ex, z: ez });
        deps.telegraph.arm(
          slot,
          TG_KIND.circle,
          ex,
          ez,
          0,
          1,
          BOSS.slam.radius * PH.slamRadiusMul[br.phase],
          Math.PI,
          now,
          br.until,
        );
      } else if (dist <= BOSS.charge.maxRange) {
        br.chargesLeft = PH.chargeChain[br.phase];
        startChargeWind(br, slot, ex, ez, now);
      } else {
        const windup = BOSS.boulder.windup * PH.windupMul[br.phase];
        br.state = BS.THROW;
        br.until = now + windup;
        br.throwsLeft = PH.boulderCount[br.phase];
        br.nextThrowAt = br.until;
        const hold =
          windup + BOSS.boulder.volleySpacing * (br.throwsLeft - 1) + STRIKE.followThrough;
        const dur = deps.clips[CLIP.ETHROW].duration;
        p.animClip = CLIP.ETHROW;
        p.animTime = 0;
        p.attackT = hold + 0.2;
        p.attackRate = (dur * STRIKE.impact.throw) / windup;
        p.recoverRate = (dur * (1 - STRIKE.impact.throw)) / (hold - windup);
        p.windupT = windup;
        p.heading = Math.atan2(player.x - ex, player.z - ez);
        p.dashT = 0;
        p.dashSpeed = 0;
        strikePatch[slot] = p;
        strikePatchCount++;
        deps.sfx('boss_slam_windup', { x: ex, z: ez, gain: 0.7, rate: 1.5 });
      }
      return;
    }

    if (br.state === BS.SLAM) {
      const radius = BOSS.slam.radius * PH.slamRadiusMul[br.phase];
      deps.emit(slamTelegraph(ex, ez, radius));
      deps.telegraph.move(slot, ex, ez, 0, 1);
      if (now < br.until) return;
      atkCd[slot] = BOSS.slam.cooldown * PH.cooldownMul[br.phase];
      br.state = BS.IDLE;
      deps.emit(slamImpact(ex, ez, radius));
      deps.sfx('boss_slam', { x: ex, z: ez });
      deps.shake(BOSS.slam.shake);
      deps.onSlam?.(ex, ez);
      const dist = Math.sqrt(distSq);
      if (dist < radius && player.invulnT <= 0) {
        const falloff = 1 - (dist / radius) * 0.65;
        player.damage(BOSS.slam.damage * falloff * dmgMul);
        hud.heat(0.5);
      }
      return;
    }

    if (br.state === BS.CHARGE_WIND) {
      deps.telegraph.move(slot, ex, ez, br.dirX, br.dirZ);
      if (now < br.until) return;
      const chargeDur = br.chargeLen / BOSS.charge.speed;
      br.state = BS.CHARGING;
      br.until = now + chargeDur;
      br.hitDone = false;
      br.px = ex;
      br.pz = ez;
      p.animClip = CLIP.RUN;
      p.animTime = 0;
      p.attackT = chargeDur + 0.3;
      p.attackRate = BOSS.charge.runRate;
      p.recoverRate = BOSS.charge.runRate;
      p.windupT = 0;
      p.heading = Math.atan2(br.dirX, br.dirZ);
      p.dashT = chargeDur;
      p.dashSpeed = BOSS.charge.speed;
      strikePatch[slot] = p;
      strikePatchCount++;
      deps.shake(0.2);
      deps.telegraph.arm(
        slot,
        TG_KIND.line,
        ex,
        ez,
        br.dirX,
        br.dirZ,
        br.chargeLen,
        BOSS.charge.width,
        now - 1,
        br.until,
      );
      return;
    }

    if (br.state === BS.CHARGING) {
      if (!br.hitDone && player.invulnT <= 0) {
        const reach = BOSS.charge.width + PLAYER.radius;
        if (segDistSq(br.px, br.pz, ex, ez) < reach * reach) {
          br.hitDone = true;
          player.damage(BOSS.charge.damage * dmgMul);
          hud.heat(0.5);
          deps.shake(BOSS.charge.shake);
        }
      }
      br.px = ex;
      br.pz = ez;
      if (now < br.until) return;
      br.chargesLeft--;
      if (br.chargesLeft > 0) {
        startChargeWind(br, slot, ex, ez, now);
        return;
      }
      br.state = BS.STAGGER;
      br.until = now + BOSS.charge.staggerT;
      p.animClip = CLIP.HIT;
      p.animTime = 0;
      p.attackT = BOSS.charge.staggerT + 0.2;
      p.attackRate = deps.clips[CLIP.HIT].duration / BOSS.charge.staggerT;
      p.recoverRate = p.attackRate;
      p.windupT = 0;
      p.dashT = 0;
      p.dashSpeed = 0;
      strikePatch[slot] = p;
      strikePatchCount++;
      deps.telegraph.clear(slot);
      return;
    }

    if (br.state === BS.STAGGER || br.state === BS.ROAR) {
      if (now < br.until) return;
      atkCd[slot] = br.state === BS.STAGGER ? BOSS.charge.cooldown * PH.cooldownMul[br.phase] : 0.8;
      br.state = BS.IDLE;
      return;
    }

    if (br.state === BS.THROW) {
      if (br.throwsLeft > 0 && now >= br.nextThrowAt) {
        br.throwsLeft--;
        br.nextThrowAt = now + BOSS.boulder.volleySpacing;
        deps.throwBoulder(ex, ez, player.x, player.z, now, BOSS.boulder.damage * dmgMul);
      }
      if (br.throwsLeft <= 0 && now >= br.until) {
        atkCd[slot] = BOSS.boulder.cooldown * PH.cooldownMul[br.phase];
        br.state = BS.IDLE;
      }
      return;
    }
  }

  function processReadback(dt: number, now: number) {
    if (!readback.hasData) return;
    const { f32, u32 } = readback;
    dmgMul = WAVES.dmgScale(wave.n) * deps.enemyDamageMul;
    let alive = 0;
    let bossHp = 0;
    let bossMaxHp = 0;
    for (let t = 0; t < ENEMY_TYPES.length; t++) {
      const type = ENEMY_TYPES[t];
      const hi = hiSlot[t];
      let seen = type.slotStart - 1;
      for (let slot = type.slotStart; slot <= hi; slot++) {
        const base = slot * stride;
        const st = u32[base + OFF.state];
        const prev = lastState[slot];
        if (
          st === STATE.ALIVE ||
          st === STATE.SPAWNING ||
          now < spawnLockUntil[slot] ||
          (st === STATE.DYING && now - deathSeenAt[slot] <= deathDur + 3)
        ) {
          seen = slot;
        }
        if (
          now < spawnLockUntil[slot] &&
          lastState[slot] === STATE.SPAWNING &&
          (st === STATE.DEAD || (st === STATE.DYING && now - spawnedAt[slot] < 0.6))
        ) {
          alive++;
          continue;
        }
        if (
          (st === STATE.DYING && prev !== STATE.DYING) ||
          (st === STATE.DEAD && prev === STATE.ALIVE)
        ) {
          registerKill(
            t,
            slot,
            f32[base + OFF.posX],
            f32[base + OFF.posY],
            (u32[base + OFF.flags] & ACTOR_FLAGS.ELITE) !== 0,
            now,
          );
        }
        lastState[slot] = st;
        if (st === STATE.ALIVE || st === STATE.SPAWNING) alive++;

        if (st === STATE.ALIVE && type.boss) {
          bossHp += f32[base + OFF.hp];
          bossMaxHp += spawnMaxHp[slot];
        }

        if (type.boss) {
          slotGlow(
            slot,
            st === STATE.ALIVE,
            f32[base + OFF.posX],
            f32[base + OFF.posY],
            BOSS.aura.lightHeight,
            BOSS.aura.lightColor,
            1 + BOSS.aura.pulseDepth * Math.sin(now * BOSS.aura.pulseSpeed),
            BOSS.aura.lightRadius,
          );
        } else if (type.summons) {
          const nf = deps.nightFactor();
          slotGlow(
            slot,
            st === STATE.ALIVE && nf > NECRO_GLOW.threshold,
            f32[base + OFF.posX],
            f32[base + OFF.posY],
            NECRO_GLOW.height,
            NECRO_GLOW.color,
            nf,
            NECRO_GLOW.radius,
          );
        }

        if (st === STATE.ALIVE && player.alive) {
          const ex = f32[base + OFF.posX];
          const ez = f32[base + OFF.posY];
          const hd = f32[base + OFF.heading];
          const dx = player.x - ex;
          const dz = player.z - ez;
          const distSq = dx * dx + dz * dz;

          const stun = f32[base + OFF.stun];

          const strike = strikeInfo[t];
          if (strike && !type.boss) {
            const bash = bashInfo[t];
            attackCycle(
              meleeKind,
              slot,
              t,
              dt,
              now,
              ex,
              ez,
              distSq,
              stun,
              strike.windup,
              bash && now >= bashReadyAt[slot] ? bash.armRange : strike.range + (strike.lunge ?? 0),
              hd,
            );
          }

          const ranged = rangedInfo[t];
          if (ranged) {
            attackCycle(
              rangedKind,
              slot,
              t,
              dt,
              now,
              ex,
              ez,
              distSq,
              stun,
              ranged.windup,
              ranged.fireRange,
              hd,
            );
          }

          if (type.summons && summonIdx[t] >= 0) {
            attackCycle(
              summonKind,
              slot,
              t,
              dt,
              now,
              ex,
              ez,
              distSq,
              stun,
              type.summons.windup,
              type.summons.range,
              hd,
            );
          }

          if (type.boss) {
            if (now >= stepAt[slot]) {
              stepAt[slot] = now + BOSS.step.period;
              const fall = Math.max(0, 1 - Math.sqrt(distSq) / BOSS.step.shakeRange);
              if (fall > 0) deps.shake(BOSS.step.shake * fall * fall);
              deps.emit(stompDust(ex, ez, type.radius));
            }
            let brain = bossBrains.get(slot);
            if (!brain) {
              brain = makeBrain();
              bossBrains.set(slot, brain);
            }
            const hpFrac = f32[base + OFF.hp] / Math.max(1, spawnMaxHp[slot]);
            bossThink(brain, slot, dt, now, ex, ez, distSq, hpFrac);
          }
        }
      }
      hiSlot[t] = seen;
    }
    wave.aliveCount = alive;
    let keep = 0;
    for (const s of pendingSpawns) {
      if (trySpawn(s.typeIdx, 0, now, s.x, s.z)) wave.aliveCount++;
      else pendingSpawns[keep++] = s;
    }
    pendingSpawns.length = keep;
    wave.bossActive = bossMaxHp > 0;
    if (strikePatchCount > 0) {
      enemyBuf.patch(strikePatch);
      strikePatch = {};
      strikePatchCount = 0;
    }
    hud.setBoss(bossMaxHp > 0 ? bossHp / bossMaxHp : -1);
  }

  function updateSpawning(dt: number, now: number) {
    if (wave.intermission > 0) {
      wave.intermission -= dt;
      if (wave.intermission <= 0) {
        wave.n++;
        wave.queue = buildWaveQueue(wave.n);
        wave.burstTimer = 0;
        hud.setWave(wave.n);
        hud.banner(isBossWave(wave.n) ? 'BLOOD MOON' : `WAVE ${wave.n}`);
        deps.sfx('wave_incoming');
      }
      return;
    }
    if (wave.queue.length > 0) {
      wave.clearTimer = 0;
      wave.burstTimer -= dt;
      if (wave.burstTimer <= 0) {
        wave.burstTimer = WAVES.burstInterval(wave.n);
        const burst = Math.min(wave.queue.length, WAVES.burstSize(wave.n));
        const angle = Math.random() * Math.PI * 2;
        for (let i = 0; i < burst; i++) {
          const type = wave.queue[wave.queue.length - 1];
          trySpawn(type, angle + (Math.random() - 0.5) * 0.9, now);
          wave.queue.pop();
        }
      }
    } else if (wave.aliveCount === 0 && pendingSpawns.length === 0) {
      wave.clearTimer += dt;
      if (wave.clearTimer >= WAVES.clearDebounce) {
        wave.clearTimer = 0;
        player.heal(WAVES.clearHeal);
        wave.intermission = WAVES.intermission;
        deps.onCheckpoint?.(wave.n + 1, wave.kills);
        hud.banner('WAVE CLEARED', 1800);
        deps.sfx('sting_wave_cleared');
      }
    } else {
      wave.clearTimer = 0;
    }
  }

  return {
    wave,
    readback,
    update(dt: number, now: number) {
      censusDt += dt;
      if (
        READBACK.hz === 0 ||
        !readback.hasData ||
        readback.snapshotId !== censusSeenId ||
        censusDt >= 1 / READBACK.hz
      ) {
        censusSeenId = readback.snapshotId;
        processReadback(censusDt, now);
        if (player.alive) updateSpawning(censusDt, now);
        if (spawnPatchCount > 0) {
          enemyBuf.patch(spawnPatch);
          spawnPatch = {};
          spawnPatchCount = 0;
        }
        spawnSfxPlayed = false;
        pushCounts();
        censusDt = 0;
      }
    },
    pushCounts,
  };
}

export type Waves = ReturnType<typeof createWaves>;
