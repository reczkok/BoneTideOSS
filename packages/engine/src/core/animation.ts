export interface ClipSource {
  name: string;
  loop: boolean;
}

export const CLIP = {
  IDLE: 0,
  WALK: 1,
  RUN: 2,
  DEATH: 3,
  HIT: 4,
  SPAWN: 5,
  EPUNCH: 6,
  ECHOP: 7,
  ESMASH: 8,
  ECAST: 9,
  ERAISE: 10,
  ETHROW: 11,
  ESTAB: 12,
  ESLICE: 13,
  ESHOOT: 14,
  EBASH: 15,
  ATTACK: 16,
  ATTACK_ALT: 17,
  CAST: 18,
  RAISE: 19,
  DODGE_F: 20,
  DODGE_B: 21,
  DODGE_L: 22,
  DODGE_R: 23,
} as const;

export const ENEMY_CLIP_COUNT = 16;

export const CLIP_SOURCES: readonly ClipSource[] = [
  { name: 'Idle_A', loop: true },
  { name: 'Walking_B', loop: true },
  { name: 'Running_A', loop: true },
  { name: 'Death_A', loop: false },
  { name: 'Hit_A', loop: false },
  { name: 'Spawn_Ground', loop: false },
  { name: 'Melee_Unarmed_Attack_Punch_A', loop: false },
  { name: 'Melee_1H_Attack_Chop', loop: false },
  { name: 'Melee_2H_Attack_Chop', loop: false },
  { name: 'Ranged_Magic_Shoot', loop: false },
  { name: 'Ranged_Magic_Summon', loop: false },
  { name: 'Throw', loop: false },
  { name: 'Melee_1H_Attack_Stab', loop: false },
  { name: 'Melee_1H_Attack_Slice_Horizontal', loop: false },
  { name: 'Ranged_1H_Shoot', loop: false },
  { name: 'Melee_Block_Attack', loop: false },
  { name: 'Melee_1H_Attack_Slice_Horizontal', loop: false },
  { name: 'Melee_1H_Attack_Stab', loop: false },
  { name: 'Ranged_Magic_Shoot', loop: false },
  { name: 'Ranged_Magic_Raise', loop: false },
  { name: 'Dodge_Forward', loop: false },
  { name: 'Dodge_Backward', loop: false },
  { name: 'Dodge_Left', loop: false },
  { name: 'Dodge_Right', loop: false },
];
