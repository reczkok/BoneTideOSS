import { d } from 'typegpu';
import { MAX_ENEMIES } from '../config.ts';
import { ActorSnap, STATE } from '../core/schemas.ts';
import type { Player } from './player.ts';
import type { Waves } from './waves.ts';

export function installDebugHook(player: Player, waves: Waves) {
  const stride = d.sizeOf(ActorSnap) / 4;
  const stateOff = d.memoryLayoutOf(ActorSnap, (s) => s.state).offset / 4;
  const { readback } = waves;

  const debugHooks = globalThis as unknown as Record<string, unknown>;
  debugHooks['__debug'] = () => ({
    player: { ...player },
    wave: { ...waves.wave, queue: waves.wave.queue.length },
    hasData: readback.hasData,
    states: (() => {
      const c = [0, 0, 0, 0];
      for (let s = 0; s < MAX_ENEMIES; s++) c[readback.u32[s * stride + stateOff]]++;
      return c;
    })(),
    nearest: (() => {
      let best = 1e9;
      for (let s = 0; s < MAX_ENEMIES; s++) {
        if (readback.u32[s * stride + stateOff] !== STATE.ALIVE) continue;
        const dx = player.x - readback.f32[s * stride];
        const dz = player.z - readback.f32[s * stride + 1];
        best = Math.min(best, Math.hypot(dx, dz));
      }
      return best;
    })(),
  });
}
