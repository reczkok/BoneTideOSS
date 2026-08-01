# Bone Tide OSS

A survivors-like written in TypeScript with [TypeGPU](https://typegpu.com).
The crowd, the elemental fields, the particles and the lighting all live on
the GPU; the CPU runs the rules and reads back a snapshot.

This is the open-source version of the game, slimmed down for release. The
engine is complete: the simulation, renderer, game rules and content here are
what the full game runs. The apps are not. The full frontends, with their
menus, skill tree screens, settings and HUD polish, are replaced by minimal
shells that boot the engine and expose just enough interface to play. The
licensed art and audio are also absent, so everything renders from procedural
placeholder meshes and the game is silent. It runs the moment it is cloned.
The same engine drives a web app and a React Native app.

## Run

Use Node 24 and pnpm 11.

```sh
pnpm install
pnpm web             # vite dev server
pnpm ios             # expo run:ios, a dev build; Expo Go cannot load react-native-webgpu
pnpm android         # expo run:android
```

WebGPU is required: current Chrome or Edge, Safari 26, or Firefox with WebGPU
turned on.

```sh
pnpm types           # typecheck all three packages
pnpm test            # engine + web unit tests
pnpm check           # oxlint + oxfmt
pnpm fix
```

## Layout

```text
packages/engine   sim, renderer, game rules, content; raw TS, no build step
  src/config/     every tunable number and all game content
  src/core/       GPU structs, kernels, world generation
  src/assets/     glTF loading, animation baking, the placeholders
  src/sim/        compute: crowd, spatial hash, fire, water, emitters
  src/renderer/   shadow, scene, post
  src/game/       CPU rules: waves, abilities, progression, saves
  src/platform/   the contract each app implements
apps/web          Vite + DOM, a minimal frontend
apps/mobile       Expo, the smallest shell that boots the engine
```

Game content is edited once, in `packages/engine/src/config/`. Both apps
import the engine as source (`@bonetide/engine/game/game.ts`); Vite and Metro
compile it and `unplugin-typegpu` handles the `'use gpu'` functions.

The engine reaches the host through three modules, `#platform/env.ts`,
`#platform/assets.ts` and `#platform/storage.ts`. Their types come from
`platform/contract/`, which contains only `declare` statements. Vite aliases
the specifier to `apps/web/src/platform/`, Metro to
`apps/mobile/src/platform/`, and the Node tests to `platform/node/`.

## Replacing the placeholders

Download the KayKit Adventurers, Skeletons, Forest Nature, and Character
Animations packs, then copy their glTF folders into
`packages/engine/assets/game/`. The complete guide gives the exact tiers,
source-to-destination map, and copy commands:

**[Install the asset packs](packages/engine/assets/README.md)**

```sh
pnpm --filter @bonetide/engine assets:check
```

No download is required to run the game; absent art uses procedural
placeholders and absent audio is silent.

## Systems

Sizes below are the defaults in `config/`.

### Enemies

Enemies live in one storage buffer of `Actor` structs, 2178 slots partitioned
by type (1024 minions, 512 of the next type, down to 2 boss slots). A slot is
dead, spawning, alive or dying. The CPU spawns by writing an actor record into
a free slot; everything after that happens in `sim/sim.ts`. Each tick one
thread per slot copies the actor into a local, runs damage, status effects,
steering, attacks and animation on it, and writes it back once.

Separation and attack queries use a neighbour grid (`sim/grid.ts`), 36 x 36
cells over the arena, rebuilt every frame: clear counts, count actors per cell
with atomics, prefix-sum the cells in one thread, scatter indices.

### Readback

The CPU needs enemy positions for auto-aim, hit sounds and kill detection. A
snapshot kernel copies six fields per slot (`ActorSnap`) into a compact
buffer. `game/readback.ts` copies the occupied slot ranges into one of three
`MAP_READ` staging buffers at 30 Hz and maps it after submit. The CPU keeps
the previous snapshot until the next one resolves, so what it sees is two or
three frames old. Nothing that must be exact goes through this path; damage
is applied on the GPU.

### Abilities

The CPU decides when an ability fires and writes its parameters into
`SimParams` (origin, direction, start time, damage). The enemy kernel reads
those and applies damage and knockback to every slot it affects. The CPU
never loops over enemies to apply an ability.

### Fire and water

One field buffer, 128 x 128 cells, six `i32` values per cell in fixed point:
fuel, heat, water height, water velocity, steam. Fire and water step on their
own fixed timers (`sim/fire.ts`, `sim/water.ts`). The CPU paints cones and
discs into the buffer when an ability lands. A blit kernel writes the buffer
into two `rgba16float` textures every step, and fragment shaders sample those
with a linear sampler instead of binding the storage buffer.

### Particles

A pool of 20480 `Particle` structs. The low 15360 are written by emitters in
the sim kernels; the rest by CPU `emit()` through a staging ring. Each frame a
compute prepass integrates all of them, then stream-compacts the live ones
into an index list and writes the count into an indirect draw buffer.

### Characters

Every animation clip is sampled at 30 fps into one joint-matrix texture at
load (`assets/anim.ts`), 23 joints per skeleton. Per frame a kernel resolves
each actor's clip, time and blend into a joint palette. The shadow and scene
passes skin the shared meshes from that palette with indirect draws sized by
the live count per type.

### Scene state

Camera, lighting, fog, point lights, the shadow map and the field textures are
declared once as accessors and slots in `renderer/scene/bindings.ts`.
`createEnv` binds them to real uniforms and textures. Passes and materials
read them through `.$`. The lighting helpers in `renderer/env.ts` are written
once and inlined into every pipeline that calls them.

### Game rules

`game/` is plain TypeScript with no GPU dependency: waves and spawning
(`waves.ts`), abilities and keystones (`abilities.ts`), the talent tree
(`tree.ts`), stats, saves, camera, day cycle. It reads the readback snapshot
and writes actor records, `SimParams` and uniforms.

## A frame

Both apps drive the engine the same way. From the mobile shell:

```ts
function runFrame(dt: number) {
  const encoder = root.device.createCommandEncoder();
  if (app.state === 'playing' || app.state === 'dead') {
    run.update(dt);
    sim.run(dt, encoder);
    readback.tick(encoder, dt);
  }
  renderer.render(dt, run.focusX, run.focusZ, encoder);
  root.device.queue.submit([encoder.finish()]);
  readback.afterSubmit();
}
```

Nothing inside the engine submits. Modules record into the encoder they are
given, so a frame is one submission. In order:

1. `run.update` runs the CPU rules and writes the player actor, `SimParams`,
   lighting and camera uniforms.
2. `sim.run` records the neighbour grid, the enemy kernel, chain lightning,
   the snapshot kernel, trample, and the fire and water steps if they are
   due.
3. `readback.tick` records a buffer copy into a staging buffer.
4. `renderer.render` records one compute pass for all per-frame prep (camera
   and shadow matrices, cloud bake, joint palettes, particle integration and
   compaction, prop culling), a depth-only shadow pass, one MSAA HDR scene
   pass every module draws into, and the post chain (haze, bloom at half
   res, sun rays, composite, optional FXAA).
5. After submit, `readback.afterSubmit` maps the staging buffer.

## Reading the engine

If you are here to learn how a game like this fits onto TypeGPU, this is the
order that makes the fewest forward references.

1. `core/schemas.ts`: every GPU struct once, shared by CPU writers, compute
   passes and vertex layouts.
2. `renderer/vitals.ts`: a self-contained fragment shader. The smallest
   file that shows the `'use gpu'` style.
3. `renderer/renderer.ts`: the frame. One command encoder, one compute
   prepass, a depth-only shadow pass, one MSAA scene pass every module draws
   into, then post.
4. `core/kernel.ts`: how compute is dispatched into that shared pass with the
   thread count baked into the shader.
5. `sim/sim.ts` and `sim/grid.ts`: the crowd. Steering, separation, attacks
   and damage as compute over a storage buffer, with a spatial hash rebuilt
   every frame.
6. `game/readback.ts`: the one place the CPU reads GPU state, a few frames
   late, on a ring of staging buffers.
7. `sim/field.ts`, `fire.ts`, `water.ts`: the elemental grid. Simulated in
   buffers, blitted to textures so fragment shaders can sample it without
   spending storage bindings.
8. `renderer/env.ts`: lighting helpers written once and called from every
   pass. This is what keeps shading consistent without duplicated WGSL.
9. `assets/anim.ts` and `renderer/characters.ts`: animation baked into a
   joint-matrix atlas, then skinned instancing that costs no per-frame CPU.
10. `sim/emitters.ts` and `renderer/particles.ts`: GPU particles with
    compaction so the draw only touches live slots.
11. `renderer/post.ts`: bloom, haze, the reveal.
12. `game/game.ts`, `waves.ts`, `abilities.ts` and `config/`: the CPU side.
    Rules read the snapshot and write intents; the GPU resolves them.
13. `platform/` and `apps/mobile`: the seam. The engine never touches
    `window`, `fetch` or storage directly, and the mobile app is the shortest
    example of what an embedder must provide.

## Toolchain

- TypeScript is [tsover](https://www.npmjs.com/package/tsover), pinned through
  a pnpm override. It gives operator overloading, so shader code writes
  `a + b * c` on vectors.
- The engine typechecks without the DOM lib. That is the guard that keeps it
  portable between the two apps.
- Engine code runs on Hermes, so no ES2023 change-by-copy array methods. The
  oxlint autofixes that introduce them are disabled.
- The mobile app requests `'implicit-device-synchronization'` as an optional
  device feature. Dawn devices are not thread-safe without it.
- Tests run on plain Node with type stripping and cover the CPU-only parts:
  config invariants, schema layouts, the save format, run stats, placeholder
  generation, the fixed-step cadence. CI runs lint, format, typecheck and
  tests.
- `.agents/skills/typegpu/` is a TypeGPU skill for coding agents.

## License

MIT, see [LICENSE](LICENSE). Art and audio you install are covered by their
own licenses.
