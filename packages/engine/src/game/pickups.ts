import type { Sfx } from '../audio/contract.ts';
import { POTIONS } from '../config.ts';
import type { ParticleSpec } from '../renderer/particles.ts';
import { mendBurst, potionMote, potionOrb } from './effects.ts';
import type { Player } from './player.ts';

interface Potion {
  x: number;
  z: number;
  born: number;
}

export function createPickups(deps: {
  player: Player;
  emit(specs: ParticleSpec[]): void;
  sfx: Sfx;
}) {
  const { player, emit, sfx } = deps;
  let potions: Potion[] = [];

  return {
    maybeDrop(x: number, z: number, now: number, nightFactor: number) {
      const chance = POTIONS.dropChance * (1 + (POTIONS.nightBonus - 1) * nightFactor);
      if (Math.random() < chance) {
        potions.push({ x, z, born: now });
        sfx('potion_drop', { x, z });
      }
    },
    drop(x: number, z: number, now: number) {
      potions.push({ x, z, born: now });
      sfx('potion_drop', { x, z });
    },
    update(_dt: number, now: number) {
      if (potions.length === 0) return;
      let w = 0;
      for (const p of potions) {
        const age = now - p.born;
        if (age >= POTIONS.lifetime) continue;
        if (player.alive) {
          const dx = player.x - p.x;
          const dz = player.z - p.z;
          if (dx * dx + dz * dz < POTIONS.pickupRadius * POTIONS.pickupRadius) {
            player.heal(POTIONS.heal);
            emit(mendBurst(p.x, p.z));
            sfx('potion_pickup');
            continue;
          }
        }
        potions[w++] = p;
        const left = POTIONS.lifetime - age;
        if (left < 4 && Math.floor(now * 5) % 2 === 0) continue;
        const bob = 0.55 + Math.sin(now * 2.4 + p.x) * 0.12;
        emit(potionOrb(p.x, bob, p.z));
        if (Math.random() < 0.06) emit(potionMote(p.x, bob + 0.15, p.z));
      }
      potions.length = w;
    },
  };
}

export type Pickups = ReturnType<typeof createPickups>;
