import {
  BLADES,
  CHAIN,
  FIRE,
  METEOR,
  PLAYER,
  SHOCK,
  SPIKES,
  VOLLEY,
  WATER,
  WELL,
} from '../config.ts';
import type { KeystoneId } from '../core/schemas.ts';
import type { AbilityId } from './abilities.ts';

export type { KeystoneId };

function baseStats() {
  return {
    player: {
      speed: PLAYER.speed,
      attackDamage: PLAYER.attackDamage,
      swingCooldown: PLAYER.swingCooldown,
      dashCooldown: PLAYER.dashCooldown,
      dashInvuln: PLAYER.dashInvuln,
      maxHp: PLAYER.maxHp,
      attackRange: PLAYER.attackRange,
      attackArcDeg: PLAYER.attackArcDeg,
    },
    nova: { damage: SHOCK.damage, chargeRate: 1 },
    meteor: { damage: METEOR.damage, cooldown: METEOR.cooldown },
    chain: { damage: CHAIN.damage, cooldown: CHAIN.cooldown },
    volley: {
      damage: VOLLEY.damage,
      count: VOLLEY.count,
      cooldown: VOLLEY.cooldown,
      poisonDps: VOLLEY.poisonDps,
    },
    well: { damage: WELL.damage, cooldown: WELL.cooldown },
    spikes: { damage: SPIKES.damage, cooldown: SPIKES.cooldown },
    fire: { dps: FIRE.dps, cooldown: FIRE.cooldown },
    deluge: { cooldown: WATER.cooldown, surge: 1 },
    blades: { dps: BLADES.dps },
  };
}

type StatGroups = ReturnType<typeof baseStats>;

export type StatPath = {
  [G in keyof StatGroups]: `${G & string}.${keyof StatGroups[G] & string}`;
}[keyof StatGroups];

export type Modifier =
  | { kind: 'add'; stat: StatPath; amount: number }
  | { kind: 'mult'; stat: StatPath; factor: number }
  | { kind: 'unlock'; ability: AbilityId }
  | { kind: 'blades'; count: number }
  | { kind: 'keystone'; id: KeystoneId };

export function createRunStats() {
  let s = baseStats();
  const unlocked = new Set<AbilityId>(['nova']);
  const keystones = new Set<KeystoneId>();
  let bladeCount = 0;
  let attackArcCos = Math.cos((s.player.attackArcDeg / 2) * (Math.PI / 180));

  const at = (path: StatPath): [Record<string, number>, string] => {
    const dot = path.indexOf('.');
    const group = path.slice(0, dot) as keyof StatGroups;
    return [s[group] as unknown as Record<string, number>, path.slice(dot + 1)];
  };

  function finalize() {
    s.player.attackArcDeg = Math.min(PLAYER.attackArcMaxDeg, s.player.attackArcDeg);
    attackArcCos = Math.cos((s.player.attackArcDeg / 2) * (Math.PI / 180));
    bladeCount = 0;
  }

  function reset() {
    s = baseStats();
    unlocked.clear();
    unlocked.add('nova');
    keystones.clear();
    finalize();
  }

  function apply(mods: readonly Modifier[]) {
    reset();
    let extraBlades = 0;
    for (const m of mods) {
      if (m.kind === 'unlock') unlocked.add(m.ability);
      else if (m.kind === 'blades') extraBlades += m.count;
      else if (m.kind === 'keystone') keystones.add(m.id);
    }
    for (const m of mods) {
      if (m.kind === 'add') {
        const [g, k] = at(m.stat);
        g[k] += m.amount;
      }
    }
    for (const m of mods) {
      if (m.kind === 'mult') {
        const [g, k] = at(m.stat);
        g[k] *= m.factor;
      }
    }
    finalize();
    if (unlocked.has('blades')) {
      bladeCount = Math.min(BLADES.maxCount, BLADES.unlockCount + extraBlades);
    }
  }

  reset();

  return {
    get player() {
      return s.player;
    },
    get nova() {
      return s.nova;
    },
    get meteor() {
      return s.meteor;
    },
    get chain() {
      return s.chain;
    },
    get volley() {
      return s.volley;
    },
    get well() {
      return s.well;
    },
    get spikes() {
      return s.spikes;
    },
    get fire() {
      return s.fire;
    },
    get deluge() {
      return s.deluge;
    },
    get blades() {
      return s.blades;
    },
    get attackArcCos() {
      return attackArcCos;
    },
    unlocked: unlocked as ReadonlySet<AbilityId>,
    keystones: keystones as ReadonlySet<KeystoneId>,
    get bladeCount() {
      return bladeCount;
    },
    reset,
    apply,
  };
}

export type RunStats = ReturnType<typeof createRunStats>;
