import type { SfxLoop } from '../audio/contract.ts';
import { AMBIENT, AUDIO } from '../config.ts';
import type { SteadyLightSpec } from '../renderer/env.ts';
import type { ParticleSpec } from '../renderer/particles.ts';
import { fallingLeaf } from './effects.ts';
import type { Player } from './player.ts';

type MutableSteadyLightSpec = SteadyLightSpec & { color: [number, number, number] };

export function createAmbience(deps: {
  emit(specs: ParticleSpec[]): void;
  steadyLight(key: string, spec: SteadyLightSpec | null): void;
  sfxLoop: SfxLoop;
}) {
  let leafTimer = 0;
  const torchSpec: MutableSteadyLightSpec = {
    x: 0,
    y: 1.7,
    z: 0,
    color: [0, 0, 0],
    radius: AMBIENT.torchRadius,
  };
  const dayOpts = { gain: 0 };
  const nightOpts = { gain: 0 };

  return {
    update(dt: number, player: Player, nightFactor: number) {
      const torchLit = player.alive && nightFactor > AMBIENT.torchThreshold;
      if (torchLit) {
        torchSpec.x = player.x;
        torchSpec.z = player.z;
        torchSpec.color[0] = AMBIENT.torchColor[0] * nightFactor;
        torchSpec.color[1] = AMBIENT.torchColor[1] * nightFactor;
        torchSpec.color[2] = AMBIENT.torchColor[2] * nightFactor;
      }
      deps.steadyLight('player', torchLit ? torchSpec : null);

      dayOpts.gain = AUDIO.ambienceGain * (1 - nightFactor);
      deps.sfxLoop('amb_day', nightFactor < 1 ? 'amb_day' : null, dayOpts);
      nightOpts.gain = AUDIO.ambienceGain * nightFactor;
      deps.sfxLoop('amb_night', nightFactor > 0 ? 'amb_night' : null, nightOpts);

      leafTimer -= dt;
      if (leafTimer <= 0) {
        leafTimer = AMBIENT.leafInterval + Math.random() * AMBIENT.leafJitter;
        deps.emit(fallingLeaf());
      }
    },
  };
}

export type Ambience = ReturnType<typeof createAmbience>;
