import type { BakedClipMeta } from '../assets/anim.ts';
import type { GameAudio } from '../audio/contract.ts';
import {
  ARROW,
  AUDIO,
  BLADES,
  BLOODMOON,
  BOSS,
  CHAIN,
  DEBUG,
  DIFFICULTY,
  type Difficulty,
  ELITES,
  ENEMY_TYPES,
  isBossWave,
  METEOR,
  PLAYER,
  type Rgb,
  SHOCK,
  SLOT_COUNT,
  TOUCH,
  WAVES,
} from '../config.ts';
import type { Renderer } from '../renderer/renderer.ts';
import {
  ACTOR_FLAGS,
  type ActorBuffer,
  type CpuRecord,
  FxData,
  KEYSTONE_BITS,
  type KeystoneId,
  makeActor,
  SimParams,
  STATE,
} from '../core/schemas.ts';
import { saturate } from '../core/mathx.ts';
import type { Sim } from '../sim/sim.ts';
import type { RockCollider } from '../core/world.ts';
import { createAbilities } from './abilities.ts';
import { createAmbience } from './ambience.ts';
import type { App } from './app.ts';
import { createBoulders } from './boulders.ts';
import type { Camera } from './camera.ts';
import { createDayCycle } from './daycycle.ts';
import { installDebugHook } from './debug.ts';
import { DEV_HOOKS } from '#platform/env.ts';
import { levelUpBurst } from './effects.ts';
import { formatTime, type Hud } from './hud.ts';
import type { Input } from './input.ts';
import { createLoadout } from './loadout.ts';
import { createArrows } from './arrows.ts';
import { createObstacles } from './obstacles.ts';
import { createPickups } from './pickups.ts';
import { createPlayer } from './player.ts';
import { createProgress } from './progress.ts';
import type { ActorReadback } from './readback.ts';
import type { SaveV3 } from './save.ts';
import type { RunStats } from './stats.ts';
import { createTalents } from './talents.ts';
import { createTelegraphs } from './telegraphs.ts';
import { createWaves } from './waves.ts';

export interface RunDeps {
  app: App;
  renderer: Renderer;
  sim: Sim;
  enemyBuf: ActorBuffer;
  playerBuf: ActorBuffer;
  clips: BakedClipMeta[];
  colliders: RockCollider[];
  input: Input;
  camera: Camera;
  hud: Hud;
  stats: RunStats;
  readback: ActorReadback;
  audio: GameAudio;
  difficulty: Difficulty;
  save?: SaveV3;
  startWave?: number;
  onCheckpoint?(save: SaveV3): void;
  onDeath?(): void;
  onTalentsChanged?(): void;
}

export function createRun(deps: RunDeps) {
  const { app, renderer, sim, playerBuf, input, camera, hud, stats, readback, audio } = deps;
  const diff = DIFFICULTY[deps.difficulty];

  const obstacles = createObstacles({
    setSimRocks: sim.setDynamicRocks,
    updateProps: renderer.updateSpikeRocks,
    emit: renderer.emit,
    sfx: audio.play,
  });
  const player = createPlayer(
    input,
    renderer.emit,
    audio.play,
    deps.clips,
    deps.colliders,
    stats,
    () => obstacles.colliders,
  );
  const loadout = createLoadout({ stats, hud });
  const abilities = createAbilities({
    input,
    sim,
    stats,
    loadout,
    obstacles,
    sfx: audio.play,
    sfxLoop: audio.loop,
    emit: renderer.emit,
    moveMeteorMesh: renderer.updateMeteor,
    shake: camera.shake,
    flash: hud.flash,
    light: renderer.light,
    steadyLight: renderer.steadyLight,
    spectral: renderer.updateSpectral,
  });
  const progress = createProgress();
  const daycycle = createDayCycle(deps.save?.wave ?? 0);
  const ambience = createAmbience({
    emit: renderer.emit,
    steadyLight: renderer.steadyLight,
    sfxLoop: audio.loop,
  });
  const arrows = createArrows({
    player,
    hud,
    updateArrows: renderer.updateEnemyArrows,
    sfx: audio.play,
    arrowSpeed: ARROW.speed * diff.boltSpeed,
  });
  const pickups = createPickups({ player, emit: renderer.emit, sfx: audio.play });
  const talents = createTalents({ stats, player, loadout });
  const telegraphs = createTelegraphs();
  const boulders = createBoulders({
    player,
    hud,
    emit: renderer.emit,
    updateRocks: renderer.updateBoulders,
    steadyLight: renderer.steadyLight,
    light: renderer.light,
    orbSpeedMul: diff.boltSpeed,
    sfx: audio.play,
    shake: camera.shake,
    telegraph: telegraphs,
  });

  function restoreRun(save: SaveV3) {
    progress.restore({ level: save.level, xp: save.xp });
    talents.restore({ points: save.points, nodes: save.nodes });
    loadout.restore(save.slots);
    abilities.setUltCharge(save.ultCharge);
    player.hp = Math.min(stats.player.maxHp, Math.max(1, save.hp));
  }

  const save = deps.save;
  if (save) restoreRun(save);
  else {
    loadout.sync();
    if (DEBUG.abilityPoints > 0) talents.grantPoint(DEBUG.abilityPoints);
  }

  let time = save?.time ?? 0;
  let deathReported = false;
  let ultWasReady = (save?.ultCharge ?? 0) >= 1;
  let wakeWide = false;
  let nightFactor = 0;
  const aimScratch = { x: 0, z: 0, autoSwing: false };

  function snapshot(nextWave: number, kills: number): SaveV3 {
    const progressSave = progress.serialize();
    const talentSave = talents.serialize();
    return {
      version: 3,
      savedAt: Date.now(),
      wave: nextWave,
      level: progressSave.level,
      xp: progressSave.xp,
      points: talentSave.points,
      nodes: talentSave.nodes,
      slots: loadout.serialize(),
      ultCharge: abilities.ultCharge,
      hp: player.hp,
      time,
      kills,
      difficulty: deps.difficulty,
    };
  }

  const waves = createWaves({
    enemyBuf: deps.enemyBuf,
    readback,
    clips: deps.clips,
    player,
    hud,
    emit: renderer.emit,
    shake: camera.shake,
    sfx: audio.play,
    enemyDamageMul: diff.enemyDamage,
    enemyHpMul: diff.enemyHp,
    light: renderer.light,
    steadyLight: renderer.steadyLight,
    nightFactor: () => nightFactor,
    ...(save
      ? { startWave: save.wave, kills: save.kills }
      : deps.startWave !== undefined
        ? { startWave: deps.startWave }
        : {}),
    onKill: (typeIdx, x, z, elite) => {
      const boss = ENEMY_TYPES[typeIdx].boss === true;
      audio.play('skeleton_death', { x, z });
      if (elite) audio.play('elite_death', { x, z });
      progress.addXp(ENEMY_TYPES[typeIdx].xp * (elite ? ELITES.xpMult : 1));
      const ringTime = (SHOCK.maxRadius + SHOCK.width) / SHOCK.speed;
      const novaLive =
        abilities.shock.start >= 0 &&
        time - abilities.shock.start < ringTime + SHOCK.chargeKillLockout;
      if (!novaLive) {
        abilities.addCharge(
          boss ? BOSS.ultCharge : elite ? SHOCK.chargePerElite : SHOCK.chargePerKill,
        );
      }
      pickups.maybeDrop(x, z, time, nightFactor);
      if (elite) {
        renderer.light({ x, y: 1.5, z, color: [1.4, 0.5, 2.2], radius: 8, life: 0.7 });
      }
      if (boss) {
        audio.play('boss_death', { x, z });
        camera.shake(0.6);
        renderer.light({ x, y: 2, z, color: [5, 1.6, 0.4], radius: 14, life: 1.2 });
        for (let i = 0; i < BOSS.potionDrops; i++) {
          const a = Math.random() * Math.PI * 2;
          const r = 1 + Math.random() * 1.5;
          pickups.drop(x + Math.cos(a) * r, z + Math.sin(a) * r, time);
        }
      }
    },
    onSlam: (x, z) => {
      renderer.light({ x, y: 0.8, z, color: [3.2, 1.1, 0.3], radius: 10, life: 0.5 });
    },
    onCheckpoint: (nextWave, kills) => deps.onCheckpoint?.(snapshot(nextWave, kills)),
    lobOrb: boulders.lobOrb,
    fireArrow: arrows.fire,
    throwBoulder: boulders.throw,
    telegraph: telegraphs,
    setEnemyCounts: renderer.setEnemyCounts,
  });
  const slotKeys = Array.from({ length: SLOT_COUNT }, (_, i) => `slot${i}`);
  const readyFrame: Record<string, boolean> = { dash: false };
  const cooldownFrame: Record<string, number> = { dash: 0 };
  for (const key of slotKeys) {
    readyFrame[key] = false;
    cooldownFrame[key] = 0;
  }
  const hudFrame = {
    hp: 0,
    maxHp: 0,
    alive: true,
    kills: 0,
    time: 0,
    level: 1,
    xpFrac: 0,
    ultCharge: 0,
    points: 0,
    ready: readyFrame,
    cooldown: cooldownFrame,
  };

  const playerActorScratch = [makeActor({ state: STATE.ALIVE, radius: PLAYER.radius })];
  const simScratch: CpuRecord<typeof SimParams> = {
    playerPos: [0, 0],
    attackOrigin: [0, 0],
    attackDir: [0, 0],
    shockOrigin: [0, 0],
    meteorPos: [0, 0],
    wellPos: [0, 0],
    spikeOrigin: [0, 0],
    spikeDir: [0, 1],
    wellStart: -100,
    wellDetonate: 0,
    spikeStart: -100,
    spikeDamage: 0,
    fireDps: 0,
    poisonDps: 0,
    waterZapStart: -100,
    waterZapDps: 0,
    shockStart: -100,
    meteorDamage: 0,
    meteorRadius: METEOR.radius,
    dt: 0,
    time: 0,
    attackDamage: 0,
    attackRange: 0,
    attackArcCos: 0,
    attackKnock: PLAYER.attackKnock,
    novaDamage: 0,
    chainDamage: 0,
    bladeDps: 0,
    bladeOrbit: BLADES.orbitRadius,
    bladeCount: 0,
    keystoneBits: 0,
    playerAlive: 1,
    enemySpeedMul: 1,
  };
  const fxScratch: CpuRecord<typeof FxData> = {
    playerPos: [0, 0],
    shockOrigin: [0, 0],
    meteorPos: [0, 0],
    wellPos: [0, 0],
    spikeOrigin: [0, 0],
    spikeDir: [0, 1],
    firePos: [0, 0],
    swingDir: [0, 1],
    shockStart: -100,
    meteorImpact: -100,
    chainStart: -100,
    wellStart: -100,
    spikeStart: -100,
    fireStart: -100,
    swingStart: -100,
    swingArc: 0,
    swingSign: 1,
    waterZapStart: -100,
  };
  const set2 = (out: [number, number], x: number, y: number) => {
    out[0] = x;
    out[1] = y;
  };

  function currentAim() {
    aimScratch.autoSwing = false;
    if (!input.isTouchMode()) {
      const p = camera.groundPoint(input.pointer.x, input.pointer.y);
      aimScratch.x = p.x;
      aimScratch.z = p.z;
      return aimScratch;
    }

    const hit = readback.nearestAlive(player.x, player.z, TOUCH.autoAimRange);
    if (hit) {
      aimScratch.x = hit.x;
      aimScratch.z = hit.z;
      aimScratch.autoSwing = hit.d2 <= (stats.player.attackRange + TOUCH.autoSwingSlack) ** 2;
      return aimScratch;
    }

    const [mx, mz] = input.moveAxis();
    aimScratch.x = player.x + (mx !== 0 || mz !== 0 ? mx : player.aimX);
    aimScratch.z = player.z + (mx !== 0 || mz !== 0 ? mz : player.aimZ);
    return aimScratch;
  }

  function writePlayerActor() {
    const a = playerActorScratch[0];
    set2(a.pos, player.x, player.z);
    a.heading = Math.atan2(player.aimX, player.aimZ);
    a.legYaw = player.legYaw;
    a.hp = player.hp;
    a.state = player.alive ? STATE.ALIVE : STATE.DYING;
    a.animClip = player.clip;
    a.animTime = player.animTime;
    a.lowerClip = player.lowerClip;
    a.lowerTime = player.lowerTime;
    a.prevClip = player.prevClip;
    a.prevTime = player.prevTime;
    a.blendT = player.blendT;
    a.flags =
      (player.alive && player.upperOverlay ? ACTOR_FLAGS.LAYERED : 0) |
      (player.blendUpper && player.blendT > 0 ? ACTOR_FLAGS.BLEND_UPPER : 0);
    a.flash = player.flash;
    playerBuf.write(playerActorScratch);
  }

  function writeGpuState(dt: number) {
    const { shock, meteor, well, spikes, fire, flood } = abilities;
    const s = simScratch;
    set2(s.playerPos, player.x, player.z);
    set2(s.attackOrigin, player.x, player.z);
    set2(s.attackDir, player.aimX, player.aimZ);
    set2(s.shockOrigin, shock.x, shock.z);
    set2(s.meteorPos, meteor.impactX, meteor.impactZ);
    s.meteorRadius = meteor.radiusThisFrame;
    set2(s.wellPos, well.x, well.z);
    s.wellStart = well.start;
    s.wellDetonate = well.detonateThisFrame;
    set2(s.spikeOrigin, spikes.x, spikes.z);
    set2(s.spikeDir, spikes.dx, spikes.dz);
    s.spikeStart = spikes.start;
    s.spikeDamage = stats.spikes.damage;
    s.fireDps = stats.fire.dps;
    s.poisonDps = stats.volley.poisonDps;
    s.waterZapStart = flood.zapStart;
    s.waterZapDps = flood.zapDps;
    s.shockStart = shock.start;
    s.meteorDamage = meteor.damageThisFrame;
    s.dt = dt;
    s.time = time;
    s.attackDamage = player.attackThisFrame;
    s.attackRange = stats.player.attackRange;
    s.attackArcCos = stats.attackArcCos;
    s.novaDamage = stats.nova.damage;
    s.chainDamage = stats.chain.damage;
    s.bladeDps = stats.blades.dps;
    s.bladeCount = stats.bladeCount;
    const toxicWake = stats.keystones.has('toxicWake');
    s.keystoneBits = 0;
    for (const [id, bit] of Object.entries(KEYSTONE_BITS)) {
      if (stats.keystones.has(id as KeystoneId)) s.keystoneBits |= bit;
    }
    s.playerAlive = player.alive ? 1 : 0;
    s.enemySpeedMul = WAVES.speedScale(waves.wave.n) * diff.enemySpeed;
    sim.params.write(s);
    if (toxicWake !== wakeWide) {
      wakeWide = toxicWake;
      renderer.setToxicWake(toxicWake);
    }

    const f = fxScratch;
    set2(f.playerPos, player.x, player.z);
    set2(f.shockOrigin, shock.x, shock.z);
    set2(f.meteorPos, meteor.x, meteor.z);
    set2(f.wellPos, well.x, well.z);
    set2(f.spikeOrigin, spikes.x, spikes.z);
    set2(f.spikeDir, spikes.dx, spikes.dz);
    f.shockStart = shock.start;
    f.meteorImpact = meteor.impactAt;
    f.chainStart = abilities.chainStart;
    f.wellStart = well.start;
    f.spikeStart = spikes.start;
    set2(f.firePos, fire.x, fire.z);
    f.fireStart = fire.start;
    set2(f.swingDir, player.aimX, player.aimZ);
    f.swingStart = player.swingT >= 0 ? time - player.swingT : -100;
    f.swingArc = stats.player.attackArcDeg * (Math.PI / 180);
    f.swingSign = player.strokeSign;
    f.waterZapStart = flood.zapStart;
    renderer.fx.write(f);
    renderer.setHazeActive(
      meteor.impactAt >= 0 ||
        well.start >= 0 ||
        fire.start >= 0 ||
        (shock.start >= 0 && time - shock.start < 0.8),
    );
    renderer.setBoltsActive(
      abilities.chainStart >= 0 && time - abilities.chainStart < CHAIN.boltLife + 0.1,
    );
    renderer.setGroundDisplaced(
      shock.start >= 0 || meteor.impactAt >= 0 || spikes.start >= 0 || well.start >= 0,
    );
  }

  let bloodFactor = 0;

  const mixRgb = (out: [number, number, number], to: Rgb, gain = 1) => {
    out[0] += (to[0] * gain - out[0]) * bloodFactor;
    out[1] += (to[1] * gain - out[1]) * bloodFactor;
    out[2] += (to[2] * gain - out[2]) * bloodFactor;
  };

  function mirror(dt: number) {
    const light = daycycle.update(dt, waves.wave.n);
    const bloodOn = isBossWave(waves.wave.n) && waves.wave.intermission <= 0 && !daycycle.lapsing;
    const bloodRate = dt / (bloodOn ? BLOODMOON.easeIn : BLOODMOON.easeOut);
    bloodFactor = saturate(bloodFactor + (bloodOn ? bloodRate : -bloodRate));
    if (bloodFactor > 0) {
      const pulse = 1 + BLOODMOON.pulseAmp * Math.sin((time * Math.PI * 2) / BLOODMOON.pulsePeriod);
      mixRgb(light.sunColor, BLOODMOON.sunColor, pulse);
      mixRgb(light.ambientSky, BLOODMOON.ambientSky);
      mixRgb(light.ambientGround, BLOODMOON.ambientGround);
      mixRgb(light.fogColor, BLOODMOON.fogColor);
      light.nightFactor += (BLOODMOON.nightFactor - light.nightFactor) * bloodFactor;
    }
    nightFactor = light.nightFactor;
    renderer.setLighting(light);
    audio.setListener(player.x, player.z);
    ambience.update(dt, player, nightFactor);
    camera.update(dt, player.x, player.z, time);
    const zRange = camera.viewGroundZRange();
    renderer.setViewZRange(zRange.minZ, zRange.maxZ);
    writePlayerActor();
    writeGpuState(dt);
    renderer.setTelegraphs(telegraphs.entries, telegraphs.compact(time));
  }

  const bladesOpts = { gain: 0 };
  const fireOpts = { x: 0, z: 0 };
  const waterOpts = { x: 0, z: 0 };
  const hordeOpts = { gain: 0 };
  const heartbeatOpts = { gain: 0 };

  if (DEV_HOOKS) installDebugHook(player, waves);

  return {
    talents,
    loadout,
    get focusX() {
      return player.x;
    },
    get focusZ() {
      return player.z;
    },
    idle(dt: number) {
      const aim = currentAim();
      player.update(dt, aim);
      mirror(dt);
    },
    update(dt: number) {
      if (player.alive && progress.consumeLevelUp()) {
        do talents.grantPoint();
        while (progress.consumeLevelUp());
        deps.onTalentsChanged?.();
        const first = progress.level === 2;
        if (first) hud.spellbookFlare(true);
        renderer.emit(levelUpBurst(player.x, player.z, first ? 1.8 : 1));
        renderer.light({
          x: player.x,
          y: 1.8,
          z: player.z,
          color: [3.2, 2.4, 0.95],
          radius: first ? 18 : 14,
          life: first ? 1.6 : 1.1,
        });
        hud.flash(first ? 0.5 : 0.32);
        camera.shake(first ? 0.3 : 0.16);
        audio.play('level_up');
      }
      time += dt;
      const aim = currentAim();
      player.update(dt, aim, aim.autoSwing);
      if (diff.regenHpPerSec > 0 && player.alive) player.heal(diff.regenHpPerSec * dt);
      if (player.attackThisFrame > 0) {
        const hits = readback.countAliveInArc(
          player.x,
          player.z,
          player.aimX,
          player.aimZ,
          stats.player.attackRange,
          stats.attackArcCos,
        );
        abilities.refundCooldowns(Math.min(hits * PLAYER.swingRefund, PLAYER.swingRefundCap));
        const hit = readback.nearestAlive(player.x, player.z, stats.player.attackRange + 0.4);
        if (hit) audio.play('sword_hit', { x: hit.x, z: hit.z });
      }
      abilities.update(dt, time, player, aim);
      obstacles.update(time);
      waves.update(dt, time);
      arrows.update(dt, time);
      boulders.update(dt, time);
      pickups.update(dt, time);
      mirror(dt);

      const ultReady = abilities.ultCharge >= 1;
      if (ultReady && !ultWasReady) audio.play('ult_ready');
      ultWasReady = ultReady;
      bladesOpts.gain = Math.min(1, 0.5 + stats.bladeCount * 0.17);
      audio.loop(
        'blades',
        player.alive && stats.bladeCount > 0 ? 'blades_orbit' : null,
        bladesOpts,
      );
      fireOpts.x = abilities.fire.x;
      fireOpts.z = abilities.fire.z;
      audio.loop('fire', sim.fireActive() ? 'fire_burn' : null, fireOpts);
      waterOpts.x = abilities.deluge.x + abilities.deluge.dx * abilities.deluge.reach * 0.5;
      waterOpts.z = abilities.deluge.z + abilities.deluge.dz * abilities.deluge.reach * 0.5;
      audio.loop('water', sim.waterActive() ? 'water_flood' : null, waterOpts);
      const alive = waves.wave.aliveCount;
      const hordeT = (alive - AUDIO.hordeMin) / (AUDIO.hordeFull - AUDIO.hordeMin);
      hordeOpts.gain = Math.min(1, hordeT);
      audio.loop('horde', hordeT > 0 ? 'amb_horde' : null, hordeOpts);
      const hpFrac = player.hp / stats.player.maxHp;
      heartbeatOpts.gain = 1 - hpFrac / AUDIO.heartbeatBelow;
      audio.loop(
        'heartbeat',
        player.alive && hpFrac < AUDIO.heartbeatBelow ? 'heartbeat_low_hp' : null,
        heartbeatOpts,
      );
      if (player.alive) {
        audio.music(waves.wave.bossActive ? 'boss' : 'battle');
        audio.musicIntensity(waves.wave.bossActive ? 1 : saturate(alive / 35));
      }

      if (!player.alive && player.deadFor > PLAYER.deathReportDelay && !deathReported) {
        deathReported = true;
        hud.setGameOverStats(
          `${waves.wave.kills} skeletons broken · wave ${waves.wave.n} · ${formatTime(time)}`,
        );
        deps.onDeath?.();
        app.to('dead');
      }
      readyFrame.dash = player.dashCd <= 0;
      cooldownFrame.dash = saturate(player.dashCd / stats.player.dashCooldown);
      for (let i = 0; i < SLOT_COUNT; i++) {
        readyFrame[slotKeys[i]] = abilities.slotReady(i);
        cooldownFrame[slotKeys[i]] = abilities.slotCooldownFrac(i);
      }
      hudFrame.hp = player.hp;
      hudFrame.maxHp = stats.player.maxHp;
      hudFrame.alive = player.alive;
      hudFrame.kills = waves.wave.kills;
      hudFrame.time = time;
      hudFrame.level = progress.level;
      hudFrame.xpFrac = progress.frac;
      hudFrame.ultCharge = abilities.ultCharge;
      hudFrame.points = talents.points;
      hud.update(dt, hudFrame);
    },
    remirror() {
      renderer.setToxicWake(wakeWide);
      mirror(0);
      waves.pushCounts();
    },
    dispose() {},
  };
}

export type Run = ReturnType<typeof createRun>;
