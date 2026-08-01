import type { AbilityId, SlottableId } from './abilities.ts';
import { ABILITY_ICONS } from './icons.ts';
import type { Modifier, StatPath } from './stats.ts';

export type BranchId = AbilityId | 'knight';

export interface TreeNode {
  id: string;
  name: string;
  desc: string;
  branch: BranchId;
  tier: number;
  maxRanks: number;
  mods(ranks: number): Modifier[];
  onBuy?: 'heal25';
}

export const ABILITY_INFO: Record<AbilityId, { name: string; blurb: string; icon: string }> = {
  nova: {
    name: 'Nova',
    icon: ABILITY_ICONS.nova,
    blurb: 'charged ultimate shockwave that expands from you and knocks enemies back',
  },
  meteor: {
    name: 'Meteor',
    icon: ABILITY_ICONS.meteor,
    blurb: 'drop a burning rock on your cursor after a short fall',
  },
  chain: {
    name: 'Chain',
    icon: ABILITY_ICONS.chain,
    blurb: 'lightning jumps through nearby enemies and stuns each target',
  },
  volley: {
    name: 'Darts',
    icon: ABILITY_ICONS.volley,
    blurb: 'shoot piercing darts that stagger and poison anything they hit',
  },
  well: {
    name: 'Well',
    icon: ABILITY_ICONS.well,
    blurb: 'place a gravity well that pulls enemies in, then detonates',
  },
  spikes: {
    name: 'Spikes',
    icon: ABILITY_ICONS.spikes,
    blurb: 'raise an ice ridge toward your cursor; it chills and leaves blockers',
  },
  fire: {
    name: 'Fire',
    icon: ABILITY_ICONS.fire,
    blurb: 'ignite a cone of wildfire that spreads through the grass',
  },
  deluge: {
    name: 'Deluge',
    icon: ABILITY_ICONS.deluge,
    blurb: 'unleash a flood surge that flows across the field, soaking and shoving the horde',
  },
  blades: {
    name: 'Blades',
    icon: ABILITY_ICONS.blades,
    blurb: 'passive spectral blades orbit you and grind nearby enemies',
  },
};

export const BRANCH_ACCENT: Record<BranchId, string> = {
  knight: '#c8a854',
  nova: '#c07ad0',
  meteor: '#d08048',
  chain: '#d8cc6a',
  volley: '#84b860',
  well: '#9a70d8',
  spikes: '#7ac8e0',
  fire: '#d85840',
  deluge: '#5890d8',
  blades: '#a8b8c8',
};

export const SLOTTABLE = Object.keys({
  meteor: 1,
  chain: 1,
  volley: 1,
  well: 1,
  spikes: 1,
  fire: 1,
  deluge: 1,
} satisfies Record<SlottableId, 1>) as SlottableId[];

const add = (stat: StatPath, amount: number) => ({ kind: 'add', stat, amount }) as const;
const mult = (stat: StatPath, factor: number) => ({ kind: 'mult', stat, factor }) as const;

const unlockNode = (ability: AbilityId, name: string, desc: string): TreeNode => ({
  id: `unlock-${ability}`,
  name,
  desc,
  branch: ability,
  tier: 1,
  maxRanks: 1,
  mods: () => [{ kind: 'unlock', ability }],
});

export const TREE: TreeNode[] = [
  {
    id: 'k-damage',
    name: 'Sharpened Steel',
    desc: '+10 sword damage',
    branch: 'knight',
    tier: 1,
    maxRanks: 3,
    mods: (r) => [add('player.attackDamage', 10 * r)],
  },
  {
    id: 'k-hp',
    name: 'Bone Marrow',
    desc: '+25 max HP and mend 25',
    branch: 'knight',
    tier: 1,
    maxRanks: 3,
    mods: (r) => [add('player.maxHp', 25 * r)],
    onBuy: 'heal25',
  },
  {
    id: 'k-speed',
    name: 'Fleet Foot',
    desc: '+10% move speed',
    branch: 'knight',
    tier: 2,
    maxRanks: 2,
    mods: (r) => [mult('player.speed', 1.1 ** r)],
  },
  {
    id: 'k-swing',
    name: 'Quick Hands',
    desc: 'swing 14% faster',
    branch: 'knight',
    tier: 2,
    maxRanks: 2,
    mods: (r) => [mult('player.swingCooldown', 0.86 ** r)],
  },
  {
    id: 'k-dash',
    name: 'Wind Step',
    desc: 'dash recovers 15% faster',
    branch: 'knight',
    tier: 3,
    maxRanks: 2,
    mods: (r) => [mult('player.dashCooldown', 0.85 ** r)],
  },
  {
    id: 'k-phase',
    name: 'Phase Step',
    desc: 'dash invulnerability lasts 0.12s longer',
    branch: 'knight',
    tier: 3,
    maxRanks: 2,
    mods: (r) => [add('player.dashInvuln', 0.12 * r)],
  },
  {
    id: 'k-arc',
    name: 'Wide Arc',
    desc: '+18° swing arc',
    branch: 'knight',
    tier: 3,
    maxRanks: 3,
    mods: (r) => [add('player.attackArcDeg', 18 * r)],
  },
  {
    id: 'k-reach',
    name: 'Long Reach',
    desc: '+0.5 swing reach',
    branch: 'knight',
    tier: 3,
    maxRanks: 2,
    mods: (r) => [add('player.attackRange', 0.5 * r)],
  },
  {
    id: 'k-keystone',
    name: 'Crescent Arc',
    desc: 'keystone: every sword strike hurls its cut down the aim line: slashes fly as arc waves, the combo-finishing stab as a piercing spear',
    branch: 'knight',
    tier: 3,
    maxRanks: 1,
    mods: () => [{ kind: 'keystone', id: 'crescent' }],
  },

  {
    id: 'nova-power',
    name: 'Greater Nova',
    desc: '+12 nova damage',
    branch: 'nova',
    tier: 1,
    maxRanks: 3,
    mods: (r) => [add('nova.damage', 12 * r)],
  },
  {
    id: 'nova-charge',
    name: 'Ravenous Earth',
    desc: 'nova charges 12% faster',
    branch: 'nova',
    tier: 2,
    maxRanks: 2,
    mods: (r) => [mult('nova.chargeRate', 1.12 ** r)],
  },

  unlockNode('meteor', 'Meteor Strike', ABILITY_INFO.meteor.blurb),
  {
    id: 'meteor-power',
    name: 'Greater Meteor',
    desc: '+25 meteor damage',
    branch: 'meteor',
    tier: 2,
    maxRanks: 3,
    mods: (r) => [add('meteor.damage', 25 * r)],
  },
  {
    id: 'meteor-cd',
    name: 'Falling Sky',
    desc: 'meteor recharges 18% faster',
    branch: 'meteor',
    tier: 2,
    maxRanks: 2,
    mods: (r) => [mult('meteor.cooldown', 0.82 ** r)],
  },
  {
    id: 'meteor-keystone',
    name: 'Meteor Shower',
    desc: 'keystone: every strike calls a barrage: burning rocks rain around the mark for seconds, setting the whole field ablaze',
    branch: 'meteor',
    tier: 3,
    maxRanks: 1,
    mods: () => [{ kind: 'keystone', id: 'meteorShower' }],
  },

  unlockNode('chain', 'Chain Lightning', ABILITY_INFO.chain.blurb),
  {
    id: 'chain-power',
    name: 'Forked Storm',
    desc: '+12 lightning damage, recharges 12% faster',
    branch: 'chain',
    tier: 2,
    maxRanks: 3,
    mods: (r) => [add('chain.damage', 12 * r), mult('chain.cooldown', 0.88 ** r)],
  },
  {
    id: 'chain-keystone',
    name: 'Conduction',
    desc: 'keystone: shock leaps between touching enemies, and water conducts: soaked bodies pass it at range, so one bolt electrocutes a flooded pack',
    branch: 'chain',
    tier: 3,
    maxRanks: 1,
    mods: () => [{ kind: 'keystone', id: 'conduction' }],
  },

  unlockNode('volley', 'Poison Darts', ABILITY_INFO.volley.blurb),
  {
    id: 'volley-power',
    name: 'Potent Venom',
    desc: '+8 dart damage, +3 poison dps',
    branch: 'volley',
    tier: 2,
    maxRanks: 3,
    mods: (r) => [add('volley.damage', 8 * r), add('volley.poisonDps', 3 * r)],
  },
  {
    id: 'volley-count',
    name: 'Extra Dart',
    desc: '+1 dart',
    branch: 'volley',
    tier: 2,
    maxRanks: 5,
    mods: (r) => [add('volley.count', r)],
  },
  {
    id: 'volley-keystone',
    name: 'Toxic Wake',
    desc: 'keystone: darts leave a lingering trail of venom; anything that brushes it is poisoned, no hit needed',
    branch: 'volley',
    tier: 3,
    maxRanks: 1,
    mods: () => [{ kind: 'keystone', id: 'toxicWake' }],
  },

  unlockNode('well', 'Gravity Well', ABILITY_INFO.well.blurb),
  {
    id: 'well-power',
    name: 'Event Horizon',
    desc: '+18 well damage, recharges 12% faster',
    branch: 'well',
    tier: 2,
    maxRanks: 3,
    mods: (r) => [add('well.damage', 18 * r), mult('well.cooldown', 0.88 ** r)],
  },
  {
    id: 'well-keystone',
    name: 'Singularity',
    desc: 'keystone: the well collapses into a true singularity: wider, hungrier, and the burst hits 35% harder',
    branch: 'well',
    tier: 3,
    maxRanks: 1,
    mods: () => [{ kind: 'keystone', id: 'singularity' }],
  },

  unlockNode('spikes', 'Ice Spikes', ABILITY_INFO.spikes.blurb),
  {
    id: 'spikes-power',
    name: 'Deep Freeze',
    desc: '+16 spike damage, recharges 12% faster',
    branch: 'spikes',
    tier: 2,
    maxRanks: 3,
    mods: (r) => [add('spikes.damage', 16 * r), mult('spikes.cooldown', 0.88 ** r)],
  },
  {
    id: 'spikes-keystone',
    name: 'Flash Freeze',
    desc: 'keystone: the ridge freezes enemies solid in glassy ice, locked mid-stride until they thaw',
    branch: 'spikes',
    tier: 3,
    maxRanks: 1,
    mods: () => [{ kind: 'keystone', id: 'flashFreeze' }],
  },

  unlockNode('fire', 'Wildfire', ABILITY_INFO.fire.blurb),
  {
    id: 'fire-power',
    name: 'Hungry Flames',
    desc: 'fire burns 40% hotter, recharges 12% faster',
    branch: 'fire',
    tier: 2,
    maxRanks: 3,
    mods: (r) => [mult('fire.dps', 1.4 ** r), mult('fire.cooldown', 0.88 ** r)],
  },
  {
    id: 'fire-keystone',
    name: 'Funeral Pyre',
    desc: 'keystone: enemies that die burning detonate, hurling and igniting everyone around them; one spark can chain a whole pack',
    branch: 'fire',
    tier: 3,
    maxRanks: 1,
    mods: () => [{ kind: 'keystone', id: 'pyre' }],
  },

  unlockNode('deluge', 'Deluge', ABILITY_INFO.deluge.blurb),
  {
    id: 'deluge-power',
    name: 'Rising Tide',
    desc: 'the surge runs 30% deeper and further, recharges 12% faster',
    branch: 'deluge',
    tier: 2,
    maxRanks: 3,
    mods: (r) => [mult('deluge.surge', 1.3 ** r), mult('deluge.cooldown', 0.88 ** r)],
  },
  {
    id: 'deluge-keystone',
    name: 'Undertow',
    desc: 'keystone: the current drags soaked enemies along the surge path; sweep whole packs into your kill zones',
    branch: 'deluge',
    tier: 3,
    maxRanks: 1,
    mods: () => [{ kind: 'keystone', id: 'undertow' }],
  },

  unlockNode('blades', 'Spirit Blades', ABILITY_INFO.blades.blurb),
  {
    id: 'blade-count',
    name: 'Another Blade',
    desc: '+1 orbiting spirit blade',
    branch: 'blades',
    tier: 2,
    maxRanks: 4,
    mods: (r) => [{ kind: 'blades', count: r }],
  },
  {
    id: 'blade-power',
    name: 'Keening Edge',
    desc: 'spirit blades grind 40% harder',
    branch: 'blades',
    tier: 2,
    maxRanks: 3,
    mods: (r) => [mult('blades.dps', 1.4 ** r)],
  },
];

export const NODE_BY_ID = new Map(TREE.map((n) => [n.id, n]));

export const BRANCH_ORDER: BranchId[] = [
  'knight',
  'nova',
  'meteor',
  'chain',
  'volley',
  'well',
  'spikes',
  'fire',
  'deluge',
  'blades',
];
