export interface EnemyType {
  name: string;
  model: string;
  hp: number;
  speed: number;
  radius: number;
  xp: number;
  holdRange?: number;
  projectile?: 'arrow';
  animRate: number;
  slots: number;
  scale?: number;
  tint?: [number, number, number];
  held?: { model: string; joint: 'handslot.r' | 'handslot.l'; rotate?: [number, number, number] }[];
  boss?: boolean;
  splitInto?: { type: string; count: number };
  summons?: {
    type: string;
    count: number;
    cooldown: number;
    range: number;
    windup: number;
    recover: number;
  };
  strike?: {
    damage: number;
    range: number;
    windup: number;
    cooldown: number;
    clip: 'punch' | 'chop' | 'smash' | 'stab' | 'slice';
    arc?: number;
    lunge?: number;
  };
  guard?: { frontFactor: number; arc: number };
  bash?: {
    damage: number;
    windup: number;
    lunge: number;
    armRange: number;
    width: number;
    cooldown: number;
    recover: number;
  };
  slotStart: number;
  slotEnd: number;
}

const ENEMY_DEFS: Omit<EnemyType, 'slotStart' | 'slotEnd'>[] = [
  {
    name: 'minion',
    model: 'Skeleton_Minion',
    hp: 22,
    speed: 4.8,
    radius: 0.42,
    xp: 4,
    animRate: 1.25,
    slots: 1024,
    strike: { damage: 11, range: 2.8, windup: 0.38, cooldown: 0.6, clip: 'punch', arc: 90 },
  },
  {
    name: 'rogue',
    model: 'Skeleton_Rogue',
    hp: 15,
    speed: 6.0,
    radius: 0.38,
    xp: 5,
    animRate: 1.55,
    slots: 512,
    held: [{ model: 'Skeleton_Dagger', joint: 'handslot.r' }],
    strike: {
      damage: 8,
      range: 2.2,
      windup: 0.34,
      cooldown: 1.1,
      clip: 'stab',
      arc: 70,
      lunge: 3,
    },
  },
  {
    name: 'warrior',
    model: 'Skeleton_Warrior',
    hp: 75,
    speed: 3.1,
    radius: 0.55,
    xp: 14,
    animRate: 1.0,
    slots: 256,
    held: [
      { model: 'Skeleton_Blade', joint: 'handslot.r' },
      { model: 'Skeleton_Shield_Small_B', joint: 'handslot.l' },
    ],
    strike: { damage: 28, range: 3.3, windup: 0.75, cooldown: 0.7, clip: 'slice', arc: 180 },
    guard: { frontFactor: 0.4, arc: 150 },
    bash: {
      damage: 16,
      windup: 0.55,
      lunge: 4.5,
      armRange: 8,
      width: 1.3,
      cooldown: 5,
      recover: 0.8,
    },
  },
  {
    name: 'mage',
    model: 'Skeleton_Mage',
    hp: 28,
    speed: 3.3,
    radius: 0.42,
    xp: 9,
    holdRange: 10,
    animRate: 1.1,
    slots: 256,
    held: [{ model: 'Skeleton_Staff', joint: 'handslot.r' }],
  },
  {
    name: 'amalgam',
    model: 'Skeleton_Minion',
    hp: 140,
    speed: 3.3,
    radius: 0.75,
    xp: 18,
    animRate: 0.8,
    slots: 64,
    scale: 1.85,
    tint: [0.62, 0.8, 0.52],
    splitInto: { type: 'minion', count: 3 },
    strike: { damage: 17, range: 3.6, windup: 0.5, cooldown: 0.65, clip: 'punch', arc: 150 },
  },
  {
    name: 'colossus',
    model: 'Skeleton_Golem',
    hp: 900,
    speed: 2.4,
    radius: 1.6,
    xp: 160,
    animRate: 0.55,
    slots: 2,
    scale: 1.75,
    tint: [0.75, 0.5, 0.45],
    held: [{ model: 'Skeleton_Golem_Axe_Large', joint: 'handslot.r' }],
    boss: true,
  },
  {
    name: 'necromancer',
    model: 'Necromancer',
    hp: 110,
    speed: 2.4,
    radius: 0.5,
    xp: 30,
    holdRange: 16,
    animRate: 0.9,
    slots: 32,
    scale: 1.15,
    tint: [0.72, 0.62, 0.85],
    held: [{ model: 'Skeleton_Scythe', joint: 'handslot.r' }],
    summons: { type: 'minion', count: 4, cooldown: 4.5, range: 26, windup: 0.5, recover: 0.6 },
  },
  {
    name: 'archer',
    model: 'Skeleton_Minion',
    hp: 45,
    speed: 3.4,
    radius: 0.42,
    xp: 12,
    holdRange: 12,
    animRate: 1.1,
    slots: 32,
    tint: [0.72, 0.68, 0.58],
    held: [{ model: 'Skeleton_Crossbow', joint: 'handslot.r', rotate: [0, 90, 0] }],
    projectile: 'arrow',
  },
];

let slotCursor = 0;
export const ENEMY_TYPES: EnemyType[] = ENEMY_DEFS.map((def) => {
  const type = {
    ...def,
    slotStart: slotCursor,
    slotEnd: slotCursor + def.slots,
  };
  slotCursor += def.slots;
  return type;
});

export const MAX_ENEMIES = slotCursor;
