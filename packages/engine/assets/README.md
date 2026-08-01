# Assets

Bone Tide runs without downloads: missing art becomes procedural placeholders
and missing audio is silent. Install the packs below only if you want the full
KayKit look.

## Install the KayKit art

### 1. Download and extract four packs

- [Adventurers](https://kaylousberg.itch.io/kaykit-adventurers), **Free 2.0**
- [Skeletons](https://kaylousberg.itch.io/kaykit-skeletons), **Extra 1.1**
- [Forest Nature](https://kaylousberg.itch.io/kaykit-forest), **Free**
- [Character Animations](https://kaylousberg.itch.io/kaykit-character-animations),
  **Free 1.1**

Skeletons is the exception to the otherwise-free setup: Bone Tide uses the
Golem and Necromancer from its Extra tier. The Source tiers are not needed.
All four packs are CC0 and do not require attribution.

### 2. Copy only the glTF folders

Copy each source folder's **contents**, not the folder itself. Keep the KayKit
filenames unchanged.

| Extracted pack folder | Copy into |
| --- | --- |
| Adventurers `Characters/gltf/` | `packages/engine/assets/game/characters/` |
| Adventurers `Assets/gltf/` | `packages/engine/assets/game/weapons/` |
| Skeletons `characters/gltf/` | `packages/engine/assets/game/characters/` |
| Skeletons `assets/gltf/` | `packages/engine/assets/game/weapons/` |
| Character Animations `Animations/gltf/Rig_Medium/` | `packages/engine/assets/game/anims/` |
| Forest Nature `Assets/gltf/` | `packages/engine/assets/game/props/` |

On macOS or Linux, edit the first four paths and run this from the repository
root:

```sh
GAME_ASSETS="packages/engine/assets/game"
KAYKIT_ADVENTURERS="/absolute/path/to/KayKit_Adventurers_2.0_FREE"
KAYKIT_SKELETONS="/absolute/path/to/KayKit_Skeletons_1.1_EXTRA"
KAYKIT_FOREST="/absolute/path/to/KayKit_Forest_Nature_Pack_1.0_FREE"
KAYKIT_ANIMATIONS="/absolute/path/to/KayKit_Character_Animations_1.1"

mkdir -p "$GAME_ASSETS/characters" "$GAME_ASSETS/weapons" "$GAME_ASSETS/anims" "$GAME_ASSETS/props"
cp "$KAYKIT_ADVENTURERS/Characters/gltf/"* "$GAME_ASSETS/characters/"
cp "$KAYKIT_ADVENTURERS/Assets/gltf/"* "$GAME_ASSETS/weapons/"
cp "$KAYKIT_SKELETONS/characters/gltf/"* "$GAME_ASSETS/characters/"
cp "$KAYKIT_SKELETONS/assets/gltf/"* "$GAME_ASSETS/weapons/"
cp "$KAYKIT_ANIMATIONS/Animations/gltf/Rig_Medium/"* "$GAME_ASSETS/anims/"
cp "$KAYKIT_FOREST/Assets/gltf/"* "$GAME_ASSETS/props/"
```

### 3. Verify

```sh
pnpm --filter @bonetide/engine assets:check
pnpm web
```

The check must print `All game art present.` A partial install fails loudly;
remove the copied art to return to placeholders, or copy the missing files
listed by the command.

The web app sees these folders through its existing symlinks. Mobile also
needs a static `require()` entry for every installed file in
`apps/mobile/src/platform/assets.ts`, because Metro cannot discover assets at
runtime.

Keep the `License.txt` files from the downloads if you redistribute the art.
The repository's MIT license does not cover third-party assets.

## Audio

Put licensed audio in `assets/audio/` using the names in `../sounds.md`:
`<slug>.ogg`, or `<slug>_1.ogg` through `<slug>_N.ogg` for variants. Missing
sounds simply do not play.

## Using different art

Custom meshes need UVs inside `[0,1]`, fewer than 65,536 vertices per mesh,
and the 23-joint KayKit-compatible rig defined by `JOINTS` in
`src/core/schemas.ts`. Nodes must use TRS transforms. Animation clip names are
defined by `CLIP_SOURCES` in `src/core/animation.ts`.
