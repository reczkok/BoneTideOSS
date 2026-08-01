import { ARENA_RADIUS, ARENA_ROCKS, FOLIAGE } from '../config.ts';

interface PropPlacement {
  pos: [number, number, number];
  rotCS: [number, number];
  scale: number;
  sway: number;
}

export type WorldScatter = Map<string, PropPlacement[]>;

export interface RockCollider {
  x: number;
  z: number;
  r: number;
}

export function rockColliders(
  scatter: WorldScatter,
  footprints: Map<string, number>,
): RockCollider[] {
  const out: RockCollider[] = [];
  for (const [name, placements] of scatter) {
    if (!name.startsWith('Rock')) continue;
    const footprint = footprints.get(name) ?? 1;
    for (const p of placements) {
      const r = footprint * p.scale * 0.85;
      if (r >= 0.5) out.push({ x: p.pos[0], z: p.pos[2], r });
    }
  }
  return out;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function scatterWorld(
  seed = 7,
  grassDensity = 1,
  footprints: Map<string, number> = new Map(),
): WorldScatter {
  const rnd = mulberry32(seed);
  const out: WorldScatter = new Map();
  const put = (name: string, p: PropPlacement) => {
    let arr = out.get(name);
    if (!arr) out.set(name, (arr = []));
    arr.push(p);
  };
  const yaw = (): [number, number] => {
    const a = rnd() * Math.PI * 2;
    return [Math.cos(a), Math.sin(a)];
  };
  const blockers: { x: number; z: number; r2: number }[] = [];
  const block = (name: string, p: PropPlacement, factor: number) => {
    const r = (footprints.get(name) ?? 1) * p.scale * factor;
    blockers.push({ x: p.pos[0], z: p.pos[2], r2: r * r });
  };
  const blocked = (x: number, z: number) => {
    for (const b of blockers) {
      const dx = x - b.x;
      const dz = z - b.z;
      if (dx * dx + dz * dz < b.r2) return true;
    }
    return false;
  };

  const TREES = [
    'Tree_1_A',
    'Tree_1_B',
    'Tree_2_B',
    'Tree_2_C',
    'Tree_3_A',
    'Tree_3_B',
    'Tree_4_A',
  ];
  const ROCKS = ['Rock_1_A', 'Rock_1_L', 'Rock_2_C', 'Rock_3_F', 'Rock_3_M'];
  const BUSHES = ['Bush_1_A', 'Bush_1_C', 'Bush_2_B', 'Bush_3_A', 'Bush_4_A'];
  const GRASS = [
    'Grass_1_A_Singlesided',
    'Grass_1_B_Singlesided',
    'Grass_1_C_Singlesided',
    'Grass_1_D_Singlesided',
    'Grass_2_A_Singlesided',
    'Grass_2_B_Singlesided',
    'Grass_2_C_Singlesided',
    'Grass_2_D_Singlesided',
  ];
  const DEAD_TREES = ['Tree_Bare_1_A', 'Tree_Bare_2_A'];

  const CLEAR = FOLIAGE.grassClearance;

  for (const rock of ARENA_ROCKS) {
    const p: PropPlacement = {
      pos: [rock.x, 0, rock.z],
      rotCS: yaw(),
      scale: rock.r * 1.05,
      sway: 0,
    };
    put('Rock_2_C', p);
    block('Rock_2_C', p, CLEAR.rock);
  }

  for (const [ringR, count, jitter] of [
    [ARENA_RADIUS + 2.5, 44, 1.6],
    [ARENA_RADIUS + 6, 40, 2.4],
    [ARENA_RADIUS + 10.5, 34, 3.2],
  ] as const) {
    for (let i = 0; i < count; i++) {
      const a = ((i + rnd() * 0.7) / count) * Math.PI * 2;
      const r = ringR + (rnd() - 0.5) * jitter * 2;
      const name = TREES[(rnd() * TREES.length) | 0];
      const p: PropPlacement = {
        pos: [Math.cos(a) * r, 0, Math.sin(a) * r],
        rotCS: yaw(),
        scale: 0.9 + rnd() * 0.7,
        sway: 0.012,
      };
      put(name, p);
      block(name, p, CLEAR.tree);
    }
  }

  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2;
    const r = ARENA_RADIUS + 13 + rnd() * 8;
    const name = DEAD_TREES[(rnd() * DEAD_TREES.length) | 0];
    const p: PropPlacement = {
      pos: [Math.cos(a) * r, 0, Math.sin(a) * r],
      rotCS: yaw(),
      scale: 1.1 + rnd() * 0.8,
      sway: 0.01,
    };
    put(name, p);
    block(name, p, CLEAR.deadTree);
  }

  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2;
    const edge = rnd() < 0.75;
    const r = edge ? ARENA_RADIUS - 3 - rnd() * 4 : 8 + rnd() * 18;
    const name = ROCKS[(rnd() * ROCKS.length) | 0];
    const p: PropPlacement = {
      pos: [Math.cos(a) * r, 0, Math.sin(a) * r],
      rotCS: yaw(),
      scale: 0.6 + rnd() * (edge ? 1.2 : 0.5),
      sway: 0,
    };
    put(name, p);
    block(name, p, CLEAR.rock);
  }

  for (let i = 0; i < 78; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 4 + Math.sqrt(rnd()) * (ARENA_RADIUS - 5);
    const name = BUSHES[(rnd() * BUSHES.length) | 0];
    const p: PropPlacement = {
      pos: [Math.cos(a) * r, 0, Math.sin(a) * r],
      rotCS: yaw(),
      scale: 0.7 + rnd() * 0.7,
      sway: 0.05,
    };
    put(name, p);
    block(name, p, CLEAR.bush);
  }

  const grassCount = Math.round(FOLIAGE.grassCount * grassDensity);
  for (let i = 0; i < grassCount; i++) {
    for (let attempt = 0; attempt < FOLIAGE.grassMaxAttempts; attempt++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * (ARENA_RADIUS + 6);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (blocked(x, z)) continue;
      put(GRASS[(rnd() * GRASS.length) | 0], {
        pos: [x, 0, z],
        rotCS: yaw(),
        scale: 0.75 + rnd() * 1.0,
        sway: 0.08 + rnd() * 0.07,
      });
      break;
    }
  }

  return out;
}
