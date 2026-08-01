export type BusName = 'music' | 'world' | 'ui';

export interface SoundDef {
  tier: 'core' | 'polish' | 'optional';
  variants?: number;
  loop?: boolean;
  gain?: number;
  jitter?: number;
  maxConcurrent?: number;
  minInterval?: number;
  bus?: BusName;
}

export const SOUNDS = {
  music_menu: { tier: 'core', loop: true, bus: 'music', jitter: 0 },
  music_battle: { tier: 'core', loop: true, bus: 'music', jitter: 0 },
  music_battle_intensity: { tier: 'polish', loop: true, bus: 'music', jitter: 0 },
  music_boss: { tier: 'core', loop: true, bus: 'music', jitter: 0 },
  sting_gameover: { tier: 'core', bus: 'music', jitter: 0 },
  sting_wave_cleared: { tier: 'polish', bus: 'music', jitter: 0, gain: 0.8 },
  wave_incoming: { tier: 'core', bus: 'music', jitter: 0, gain: 0.85 },

  amb_day: { tier: 'core', loop: true, jitter: 0 },
  amb_night: { tier: 'core', loop: true, jitter: 0 },
  amb_horde: { tier: 'polish', loop: true, jitter: 0 },

  sword_swing: { tier: 'core', variants: 5, gain: 0.75, jitter: 0.07, maxConcurrent: 3 },
  sword_hit: { tier: 'core', variants: 4, gain: 0.9, jitter: 0.08, maxConcurrent: 4 },
  dash: { tier: 'core', variants: 2, gain: 0.8 },
  player_hurt: { tier: 'core', variants: 3, minInterval: 0.55, maxConcurrent: 2 },
  player_death: { tier: 'core', maxConcurrent: 1 },
  footstep_grass: { tier: 'core', variants: 6, gain: 0.3, jitter: 0.1, maxConcurrent: 3 },
  heartbeat_low_hp: { tier: 'polish', loop: true, bus: 'ui', gain: 0.7 },

  ult_nova: { tier: 'core', gain: 1.1, maxConcurrent: 1 },
  ult_ready: { tier: 'polish', bus: 'ui', gain: 0.7, minInterval: 2 },
  meteor_fall: { tier: 'core', maxConcurrent: 2 },
  meteor_impact: { tier: 'core', gain: 1.05 },
  chain_lightning: { tier: 'core', maxConcurrent: 2 },
  volley_loose: { tier: 'core', variants: 2, gain: 0.85 },
  blades_orbit: { tier: 'polish', loop: true, gain: 0.4 },
  well_loop: { tier: 'core', loop: true, gain: 0.9 },
  well_detonate: { tier: 'core', gain: 1.05 },
  spikes_erupt: { tier: 'core', gain: 0.95 },
  ice_melt: { tier: 'polish', variants: 2, gain: 0.55, minInterval: 0.15, maxConcurrent: 2 },
  fire_cast: { tier: 'core', gain: 0.9 },
  fire_burn: { tier: 'core', loop: true, gain: 0.8 },
  water_cast: { tier: 'polish', gain: 0.95 },
  water_flood: { tier: 'polish', loop: true, gain: 0.8 },

  skeleton_spawn: {
    tier: 'core',
    variants: 7,
    gain: 0.45,
    jitter: 0.1,
    maxConcurrent: 3,
    minInterval: 0.06,
  },
  skeleton_death: {
    tier: 'core',
    variants: 5,
    gain: 0.6,
    jitter: 0.12,
    maxConcurrent: 4,
    minInterval: 0.04,
  },
  amalgam_split: { tier: 'polish', gain: 0.85 },
  magebolt_cast: { tier: 'core', variants: 2, gain: 0.6, maxConcurrent: 3 },
  magebolt_hit: { tier: 'core', gain: 0.9 },
  elite_death: { tier: 'polish', gain: 0.7, maxConcurrent: 2 },

  boss_spawn: { tier: 'core', gain: 1.05, maxConcurrent: 1 },
  boss_slam_windup: { tier: 'core', maxConcurrent: 2 },
  boss_slam: { tier: 'core', gain: 1.05 },
  boss_death: { tier: 'core', gain: 1.1, maxConcurrent: 1 },

  potion_drop: { tier: 'polish', gain: 0.5, maxConcurrent: 3 },
  potion_pickup: { tier: 'core', gain: 0.85 },
  level_up: { tier: 'core', bus: 'ui', gain: 0.9 },

  ui_click: { tier: 'core', variants: 4, bus: 'ui', gain: 0.5, minInterval: 0.03 },
  ui_hover: { tier: 'optional', bus: 'ui', gain: 0.25, minInterval: 0.05 },
  ui_start: { tier: 'core', bus: 'ui', gain: 0.9, jitter: 0 },
  ui_pause: { tier: 'polish', bus: 'ui', gain: 0.6, jitter: 0 },
  ui_resume: { tier: 'polish', bus: 'ui', gain: 0.6, jitter: 0 },
  ui_talent_buy: { tier: 'core', bus: 'ui', gain: 0.8 },
  ui_slot_assign: { tier: 'polish', bus: 'ui', gain: 0.7 },
  ui_denied: { tier: 'polish', bus: 'ui', gain: 0.55, minInterval: 0.12 },
  ui_tree_open: { tier: 'polish', bus: 'ui', gain: 0.7, jitter: 0 },
  ui_tree_close: { tier: 'polish', bus: 'ui', gain: 0.7, jitter: 0 },
} as const satisfies Record<string, SoundDef>;

export type SoundId = keyof typeof SOUNDS;

export const SOUND_IDS = Object.keys(SOUNDS) as SoundId[];
