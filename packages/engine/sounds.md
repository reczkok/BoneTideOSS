# Sound guide

Every sound the game knows how to play. None of them ship here. A missing
file logs once and that sound no-ops forever, so the game is fully playable
in silence.

Files go in `assets/audio/`. Prefer `.ogg`; `.mp3`, `.m4a`, and `.wav` also
work. Sounds with variants use numbered files such as `dash_1.ogg` and
`dash_2.ogg`. Loops must be seamless. The authoritative tier, variant count,
gain, and concurrency settings live in `src/audio/manifest.ts`.

## Music and ambience

- `music_menu`: menu loop
- `music_battle`: combat loop
- `music_battle_intensity`: combat intensity layer
- `music_boss`: boss loop
- `sting_gameover`: death sting
- `sting_wave_cleared`: wave-clear sting
- `wave_incoming`: new-wave cue
- `amb_day`: daytime meadow loop
- `amb_night`: nighttime meadow loop
- `amb_horde`: bone-rattle horde loop

## Player

- `sword_swing`: sword whoosh
- `sword_hit`: bone impact
- `dash`: short air dash
- `player_hurt`: armor hit
- `player_death`: armored fall
- `footstep_grass`: soft grass step
- `heartbeat_low_hp`: low-health loop

## Abilities

- `ult_nova`: large golden shockwave
- `ult_ready`: ultimate-ready cue
- `meteor_fall`: falling meteor
- `meteor_impact`: rock explosion
- `chain_lightning`: thunder and arc crackle
- `volley_loose`: dart volley
- `blades_orbit`: spectral blade loop
- `well_loop`: gravity-well loop
- `well_detonate`: gravity-well implosion
- `spikes_erupt`: ice and earth eruption
- `ice_melt`: spike melt
- `fire_cast`: fire ignition
- `fire_burn`: wildfire loop
- `water_cast`: flood cast
- `water_flood`: rushing-water loop

## Enemies and boss

- `skeleton_spawn`: skeleton rising
- `skeleton_death`: bone collapse
- `amalgam_split`: splitter burst
- `magebolt_cast`: mage projectile cast
- `magebolt_hit`: projectile impact
- `elite_death`: elite release
- `boss_spawn`: boss entrance
- `boss_slam_windup`: slam warning
- `boss_slam`: slam impact
- `boss_death`: boss collapse

## Progression and UI

- `potion_drop`: potion appears
- `potion_pickup`: potion collected
- `level_up`: level gained
- `ui_click`: button click
- `ui_hover`: desktop hover
- `ui_start`: sword draw
- `ui_pause`: pause
- `ui_resume`: resume
- `ui_talent_buy`: talent bought
- `ui_slot_assign`: ability assigned
- `ui_denied`: unavailable action
- `ui_tree_open`: talent tree opens
- `ui_tree_close`: talent tree closes
