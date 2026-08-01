import { SOUNDS, type SoundDef, type SoundId } from '../audio/manifest.ts';
import { ENEMY_TYPES } from '../config.ts';

export const PROP_FILES = [
  'Tree_1_A',
  'Tree_1_B',
  'Tree_2_B',
  'Tree_2_C',
  'Tree_3_A',
  'Tree_3_B',
  'Tree_4_A',
  'Tree_Bare_1_A',
  'Tree_Bare_2_A',
  'Rock_1_A',
  'Rock_1_L',
  'Rock_2_C',
  'Rock_3_F',
  'Rock_3_M',
  'Bush_1_A',
  'Bush_1_C',
  'Bush_2_B',
  'Bush_3_A',
  'Bush_4_A',
  'Grass_1_A_Singlesided',
  'Grass_1_B_Singlesided',
  'Grass_1_C_Singlesided',
  'Grass_1_D_Singlesided',
  'Grass_2_A_Singlesided',
  'Grass_2_B_Singlesided',
  'Grass_2_C_Singlesided',
  'Grass_2_D_Singlesided',
] as const;

const gltfPair = (path: string) => [`${path}.gltf`, `${path}.bin`];
const enemyModels = [...new Set(ENEMY_TYPES.map((enemy) => enemy.model))];
const heldWeapons = [
  ...new Set(ENEMY_TYPES.flatMap((enemy) => enemy.held?.map((held) => held.model) ?? [])),
];

export const GAME_ASSET_PATHS = [
  'characters/Knight.glb',
  ...enemyModels.map((model) => `characters/${model}.glb`),
  'characters/skeleton_texture.png',
  'weapons/knight_texture.png',
  ...gltfPair('weapons/sword_1handed'),
  ...heldWeapons.flatMap((model) => gltfPair(`weapons/${model}`)),
  ...gltfPair('weapons/Skeleton_Arrow'),
  'anims/Rig_Medium_General.glb',
  'anims/Rig_Medium_MovementBasic.glb',
  'anims/Rig_Medium_CombatMelee.glb',
  'anims/Rig_Medium_CombatRanged.glb',
  'anims/Rig_Medium_MovementAdvanced.glb',
  'props/forest_texture.png',
  ...PROP_FILES.flatMap((name) => gltfPair(`props/${name}_Color1`)),
] as const;

export interface AudioRequirement {
  id: SoundId;
  tier: 'core' | 'polish' | 'optional';
  stem: string;
}

export const AUDIO_REQUIREMENTS: readonly AudioRequirement[] = (
  Object.entries(SOUNDS) as [SoundId, SoundDef][]
).flatMap(([id, def]) => {
  const variants = def.variants ?? 1;
  return Array.from({ length: variants }, (_, index) => ({
    id,
    tier: def.tier,
    stem: variants === 1 ? id : `${id}_${index + 1}`,
  }));
});
