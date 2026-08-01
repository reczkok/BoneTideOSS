import { BAKE_FPS, type BakedClipMeta } from '../assets/anim.ts';
import type { Sfx } from '../audio/contract.ts';
import { LOCO, PLAYER, PLAYER_ANIM } from '../config.ts';
import { normalize2, saturate } from '../core/mathx.ts';
import type { RockCollider } from '../core/world.ts';
import { CLIP } from '../core/animation.ts';
import { clampToArena } from './aim.ts';
import { dashDust, stabSparks, swingSparks } from './effects.ts';
import type { Input } from './input.ts';
import type { RunStats } from './stats.ts';
import type { ParticleSpec } from '../renderer/particles.ts';

export function createPlayer(
  input: Input,
  emit: (specs: ParticleSpec[]) => void,
  sfx: Sfx,
  clips: BakedClipMeta[],
  colliders: RockCollider[],
  stats: RunStats,
  dynamicColliders: () => readonly RockCollider[] = () => [],
) {
  const runLoopDur = clips[CLIP.RUN].frameCount / BAKE_FPS;
  const runPlants = clips[CLIP.RUN].plantPhases ?? [0, 0.5];
  const toRad = Math.PI / 180;
  const maxLegTwist = LOCO.maxLegTwistDeg * toRad;
  const backEnter = LOCO.backEnterDeg * toRad;
  const backExit = LOCO.backExitDeg * toRad;
  const wrapAngle = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
  let backpedal = false;
  let lastClip = CLIP.IDLE as number;
  let combo = -1;
  let lastAnimTime = 0;
  let lastOverlay = false;
  let stepCycles = 0;

  const player = {
    x: 0,
    z: 3,
    aimX: 0,
    aimZ: -1,
    hp: stats.player.maxHp,
    swingCd: 0,
    swingT: -1,
    dashCd: 0,
    dashT: 0,
    invulnT: 0,
    dashDirX: 0,
    dashDirZ: 0,
    alive: true,
    deadFor: 0,
    clip: CLIP.IDLE as number,
    animTime: 0,
    lowerClip: CLIP.IDLE as number,
    lowerTime: 0,
    flash: 0,
    moving: false,
    legYaw: 0,
    attackThisFrame: 0,
    attackClip: CLIP.ATTACK as number,
    strokeSign: -1,
    castClip: CLIP.CAST as number,
    castT: -1,
    castDur: 0,
    dodgeClip: CLIP.DODGE_F as number,
    dodgeT: -1,
    prevClip: CLIP.IDLE as number,
    prevTime: 0,
    blendT: 0,
    blendUpper: false,
    get upperOverlay() {
      return player.dodgeT < 0 && (player.swingT >= 0 || player.castT >= 0);
    },

    damage(amount: number) {
      player.hp -= amount;
      if (player.alive) sfx('player_hurt');
    },
    heal(amount: number) {
      player.hp = Math.min(stats.player.maxHp, player.hp + amount);
    },
    playCast(clip: number, dur: number) {
      if (player.swingT >= 0 || !player.alive) return;
      player.castClip = clip;
      player.castT = 0;
      player.castDur = dur;
    },

    update(dt: number, aim: { x: number; z: number }, autoSwing = false) {
      player.attackThisFrame = 0;
      if (!player.alive) {
        player.deadFor += dt;
        player.animTime += dt;
        player.blendT = Math.max(0, player.blendT - dt);
        easeLegYaw(0, dt);
        return;
      }

      const [mx, mz] = input.moveAxis();
      player.moving = mx !== 0 || mz !== 0;

      player.dashCd -= dt;
      player.invulnT -= dt;
      if (input.consume('dash') && player.dashCd <= 0) {
        const dirX = player.moving ? mx : player.aimX;
        const dirZ = player.moving ? mz : player.aimZ;
        player.dashT = PLAYER.dashTime;
        player.dashCd = stats.player.dashCooldown;
        player.invulnT = stats.player.dashInvuln;
        player.dashDirX = dirX;
        player.dashDirZ = dirZ;
        const rel = wrapAngle(Math.atan2(dirX, dirZ) - Math.atan2(player.aimX, player.aimZ));
        const absRel = Math.abs(rel);
        player.dodgeClip =
          absRel < Math.PI / 4
            ? CLIP.DODGE_F
            : absRel > (Math.PI * 3) / 4
              ? CLIP.DODGE_B
              : rel < 0
                ? CLIP.DODGE_R
                : CLIP.DODGE_L;
        player.dodgeT = 0;
        emit(dashDust(player.x, player.z, dirX, dirZ));
        sfx('dash');
      }

      let vx = mx * stats.player.speed;
      let vz = mz * stats.player.speed;
      if (player.dashT > 0) {
        player.dashT -= dt;
        vx = player.dashDirX * PLAYER.dashSpeed;
        vz = player.dashDirZ * PLAYER.dashSpeed;
      }
      player.x += vx * dt;
      player.z += vz * dt;
      clampToArena(player, 0.6);
      for (const rock of colliders) {
        pushOutRock(rock);
      }
      for (const rock of dynamicColliders()) {
        pushOutRock(rock);
      }

      const ax = aim.x - player.x;
      const az = aim.z - player.z;
      const [aimX, aimZ, alen] = normalize2(ax, az);
      if (alen > 0.001) {
        player.aimX = aimX;
        player.aimZ = aimZ;
      }

      player.swingCd -= dt;
      if (player.swingT >= 0) {
        const prev = player.swingT;
        player.swingT += dt;
        if (prev < PLAYER.swingHitTime && player.swingT >= PLAYER.swingHitTime) {
          player.attackThisFrame = stats.player.attackDamage;
        }
        const window = PLAYER.sparkEnd - PLAYER.sparkStart;
        const w0 = saturate((prev - PLAYER.sparkStart) / window);
        const w1 = saturate((player.swingT - PLAYER.sparkStart) / window);
        if (w1 > w0) {
          emit(
            player.strokeSign === 0
              ? stabSparks(player.x, player.z, player.aimX, player.aimZ, w0, w1)
              : swingSparks(
                  player.x,
                  player.z,
                  player.aimX,
                  player.aimZ,
                  stats.player.attackArcDeg,
                  w0,
                  w1,
                  player.strokeSign,
                ),
          );
        }
        if (player.swingT > PLAYER.swingDuration) player.swingT = -1;
      }
      if ((input.pointer.down || autoSwing) && player.swingCd <= 0 && player.swingT < 0) {
        player.swingT = 0;
        player.swingCd = stats.player.swingCooldown;
        combo = (combo + 1) % 3;
        player.attackClip = combo === 2 ? CLIP.ATTACK_ALT : CLIP.ATTACK;
        player.strokeSign = combo === 0 ? -1 : combo === 1 ? 1 : 0;
        sfx('sword_swing');
      }

      if (player.castT >= 0) {
        player.castT += dt;
        if (player.castT > player.castDur) player.castT = -1;
      }
      if (player.dodgeT >= 0) {
        player.dodgeT += dt;
        if (player.dodgeT > PLAYER_ANIM.dodgeDur) player.dodgeT = -1;
      }

      const speed = Math.hypot(vx, vz);
      if (speed > LOCO.idleBelow) {
        if (player.lowerClip !== CLIP.RUN) {
          player.lowerClip = CLIP.RUN;
          player.lowerTime = 0;
          stepCycles = 0;
        }
        const rel = wrapAngle(Math.atan2(vx, vz) - Math.atan2(player.aimX, player.aimZ));
        const absRel = Math.abs(rel);
        if (backpedal ? absRel < backExit : absRel > backEnter) backpedal = !backpedal;
        const target = backpedal ? wrapAngle(rel - Math.PI) : rel;
        easeLegYaw(Math.max(-maxLegTwist, Math.min(maxLegTwist, target)), dt);
        const rate = Math.min(LOCO.maxRate, Math.max(LOCO.minRate, speed / LOCO.runRefSpeed));
        player.lowerTime += dt * (backpedal ? -rate : rate);
        if (player.lowerTime < 0) player.lowerTime += runLoopDur;
        const before = stepCycles;
        stepCycles += (dt * (backpedal ? -rate : rate)) / runLoopDur;
        if (player.dashT <= 0) {
          for (const pf of runPlants) {
            if (Math.floor(stepCycles - pf) !== Math.floor(before - pf)) sfx('footstep_grass');
          }
        }
      } else {
        if (player.lowerClip !== CLIP.IDLE) {
          player.lowerClip = CLIP.IDLE;
          player.lowerTime = 0;
        }
        player.lowerTime += dt;
        easeLegYaw(0, dt);
      }
      if (player.dodgeT >= 0) {
        player.clip = player.dodgeClip;
        player.animTime =
          (player.dodgeT / PLAYER_ANIM.dodgeDur) *
          PLAYER_ANIM.dodgeSpan *
          clips[player.dodgeClip].duration;
      } else if (player.swingT >= 0) {
        player.clip = player.attackClip;
        const sweep = player.swingT / PLAYER.swingDuration;
        const win =
          player.attackClip === CLIP.ATTACK_ALT
            ? PLAYER_ANIM.swingAlt
            : player.strokeSign > 0
              ? PLAYER_ANIM.swingBack
              : PLAYER_ANIM.swing;
        const f = player.strokeSign > 0 ? 1 - sweep : sweep;
        player.animTime = (win.trim + f * win.span) * clips[player.attackClip].duration;
      } else if (player.castT >= 0) {
        player.clip = player.castClip;
        player.animTime = (player.castT / player.castDur) * clips[player.castClip].duration;
      } else {
        player.clip = player.lowerClip;
        player.animTime = player.lowerTime;
      }

      player.flash = Math.max(0, player.flash - 4 * dt);

      if (player.hp <= 0) {
        player.hp = 0;
        player.alive = false;
        player.clip = CLIP.DEATH;
        player.animTime = 0;
        player.deadFor = 0;
        sfx('player_death');
      }

      player.blendT = Math.max(0, player.blendT - dt);
      if (player.clip !== lastClip) {
        player.prevClip = lastClip;
        player.prevTime = lastAnimTime;
        player.blendT = PLAYER_ANIM.blendDur;
        player.blendUpper = lastOverlay;
      }
      lastClip = player.clip;
      lastAnimTime = player.animTime;
      lastOverlay = player.upperOverlay;
    },
  };

  function easeLegYaw(target: number, dt: number) {
    player.legYaw += wrapAngle(target - player.legYaw) * Math.min(1, LOCO.twistLerp * dt);
  }

  function pushOutRock(rock: RockCollider) {
    if (rock.r <= 0) return;
    const dx = player.x - rock.x;
    const dz = player.z - rock.z;
    const rr = rock.r + PLAYER.radius;
    const d2 = dx * dx + dz * dz;
    if (d2 < rr * rr && d2 > 1e-6) {
      const dist = Math.sqrt(d2);
      player.x = rock.x + (dx / dist) * rr;
      player.z = rock.z + (dz / dist) * rr;
    }
  }

  return player;
}

export type Player = ReturnType<typeof createPlayer>;
