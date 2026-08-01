import type { Sfx } from '../audio/contract.ts';
import { ARROW, PLAYER } from '../config.ts';
import { normalize2 } from '../core/mathx.ts';
import type { CpuRecord } from '../core/schemas.ts';
import { SpectralInstance, type SpectralInstanceSpec } from '../renderer/spectral.ts';
import type { Hud } from './hud.ts';
import type { Player } from './player.ts';

interface Arrow {
  x: number;
  z: number;
  dx: number;
  dz: number;
  yaw: number;
  start: number;
  damage: number;
}

type PooledSpectralInstance = CpuRecord<typeof SpectralInstance>;

export function createArrows(deps: {
  player: Player;
  hud: Hud;
  updateArrows(instances: SpectralInstanceSpec[]): void;
  sfx: Sfx;
  arrowSpeed: number;
}) {
  const { player, hud, updateArrows, sfx, arrowSpeed } = deps;
  const arrows: Arrow[] = [];

  const scratch: PooledSpectralInstance[] = Array.from({ length: ARROW.maxInFlight }, () => ({
    pos: [0, -100, 0],
    yaw: 0,
    scale: 0,
  }));
  let shown = false;

  return {
    fire(x: number, z: number, now: number, damage: number) {
      if (arrows.length >= ARROW.maxInFlight) return;
      const aimX = player.x - x;
      const aimZ = player.z - z;
      const [aimDirX, aimDirZ, aimLen] = normalize2(aimX, aimZ);
      if (aimLen < 1e-3) return;
      const ox = x + aimDirX * ARROW.muzzleForward;
      const oz = z + aimDirZ * ARROW.muzzleForward;
      const dx = player.x - ox;
      const dz = player.z - oz;
      const [ndx, ndz, len] = normalize2(dx, dz);
      if (len < 1e-3) return;
      arrows.push({
        x: ox,
        z: oz,
        dx: ndx,
        dz: ndz,
        yaw: Math.atan2(ndx, ndz),
        start: now,
        damage,
      });
    },
    update(_dt: number, now: number) {
      if (arrows.length === 0) {
        if (shown) {
          shown = false;
          updateArrows(scratch);
        }
        return;
      }
      const life = ARROW.range / arrowSpeed;
      let w = 0;
      for (const b of arrows) {
        const age = now - b.start;
        if (age >= life) continue;
        const travel = age * arrowSpeed;
        const px = b.x + b.dx * travel;
        const pz = b.z + b.dz * travel;
        if (player.alive && player.invulnT <= 0) {
          const reach = ARROW.hitRadius + PLAYER.radius;
          const pdx = player.x - px;
          const pdz = player.z - pz;
          if (pdx * pdx + pdz * pdz < reach * reach) {
            player.damage(b.damage);
            sfx('magebolt_hit');
            hud.heat(0.35);
            continue;
          }
        }
        const inst = scratch[w];
        inst.pos[0] = px;
        inst.pos[1] = ARROW.height;
        inst.pos[2] = pz;
        inst.yaw = b.yaw;
        inst.scale = 1;
        arrows[w++] = b;
      }
      arrows.length = w;
      for (let i = w; i < ARROW.maxInFlight; i++) {
        scratch[i].scale = 0;
      }
      shown = w > 0;
      updateArrows(scratch);
    },
  };
}

export type Arrows = ReturnType<typeof createArrows>;
