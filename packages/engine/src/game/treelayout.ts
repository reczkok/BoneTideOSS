import { BRANCH_ORDER, type BranchId, TREE, type TreeNode } from './tree.ts';

export const required = <T>(value: T | undefined, label: string): T => {
  if (value === undefined) throw new Error(`missing ${label}`);
  return value;
};

export const WORLD = 1600;
export const CENTER = WORLD / 2;
export const TIER_R = [0, 210, 330, 460];
const SPREAD = 96;
const INNER_LABEL_R = 118;

const BRANCH_ANGLE = new Map<BranchId, number>(
  BRANCH_ORDER.map((b, i) => [b, -Math.PI / 2 + (i * 2 * Math.PI) / BRANCH_ORDER.length]),
);

function branchTiers(branch: BranchId) {
  const tiers = new Map<number, TreeNode[]>();
  for (const n of TREE) {
    if (n.branch !== branch) continue;
    tiers.set(n.tier, [...(tiers.get(n.tier) ?? []), n]);
  }
  return tiers;
}

export const NODE_POS = new Map<string, { x: number; y: number }>();
export const LABEL_POS = new Map<BranchId, { x: number; y: number; rot: number }>();
for (const branch of BRANCH_ORDER) {
  const a = required(BRANCH_ANGLE.get(branch), `angle for ${branch}`);
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  for (const [tier, nodes] of branchTiers(branch)) {
    nodes.forEach((n, i) => {
      const off = (i - (nodes.length - 1) / 2) * SPREAD;
      NODE_POS.set(n.id, {
        x: CENTER + dx * TIER_R[tier] - dy * off,
        y: CENTER + dy * TIER_R[tier] + dx * off,
      });
    });
  }
  LABEL_POS.set(branch, {
    x: CENTER + dx * INNER_LABEL_R,
    y: CENTER + dy * INNER_LABEL_R,
    rot: dx < 0 ? a + Math.PI : a,
  });
}

export const BRANCH_BOUNDS = new Map<
  BranchId,
  { minX: number; minY: number; maxX: number; maxY: number }
>();
for (const branch of BRANCH_ORDER) {
  const box = { minX: CENTER, minY: CENTER, maxX: CENTER, maxY: CENTER };
  for (const n of TREE) {
    if (n.branch !== branch) continue;
    const p = required(NODE_POS.get(n.id), `position for ${n.id}`);
    box.minX = Math.min(box.minX, p.x);
    box.minY = Math.min(box.minY, p.y);
    box.maxX = Math.max(box.maxX, p.x);
    box.maxY = Math.max(box.maxY, p.y);
  }
  const pad = 70;
  BRANCH_BOUNDS.set(branch, {
    minX: box.minX - pad,
    minY: box.minY - pad,
    maxX: box.maxX + pad,
    maxY: box.maxY + pad,
  });
}

export const CONTENT = (() => {
  const box = { minX: CENTER, minY: CENTER, maxX: CENTER, maxY: CENTER };
  for (const { x, y } of [...NODE_POS.values(), ...LABEL_POS.values()]) {
    box.minX = Math.min(box.minX, x);
    box.minY = Math.min(box.minY, y);
    box.maxX = Math.max(box.maxX, x);
    box.maxY = Math.max(box.maxY, y);
  }
  const pad = 50;
  return {
    minX: box.minX - pad,
    minY: box.minY - pad,
    maxX: box.maxX + pad,
    maxY: box.maxY + pad,
  };
})();

export type SegLit =
  | { kind: 'always' }
  | { kind: 'ranked'; id: string }
  | { kind: 'open'; node: TreeNode };
export type Seg = { x1: number; y1: number; x2: number; y2: number; lit: SegLit; branch: BranchId };
export const SEGS: Seg[] = [];
export const GATES: { x: number; y: number; node: TreeNode; branch: BranchId }[] = [];
for (const branch of BRANCH_ORDER) {
  const a = required(BRANCH_ANGLE.get(branch), `angle for ${branch}`);
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const tiers = branchTiers(branch);
  for (const [tier, nodes] of tiers) {
    if (tier === 1) {
      for (const n of nodes) {
        const p = required(NODE_POS.get(n.id), `position for ${n.id}`);
        SEGS.push({ x1: CENTER, y1: CENTER, x2: p.x, y2: p.y, lit: { kind: 'always' }, branch });
      }
      continue;
    }
    const gr = (TIER_R[tier - 1] + TIER_R[tier]) / 2;
    const gx = CENTER + dx * gr;
    const gy = CENTER + dy * gr;
    for (const p of tiers.get(tier - 1) ?? []) {
      const q = required(NODE_POS.get(p.id), `position for ${p.id}`);
      SEGS.push({ x1: q.x, y1: q.y, x2: gx, y2: gy, lit: { kind: 'ranked', id: p.id }, branch });
    }
    for (const n of nodes) {
      const p = required(NODE_POS.get(n.id), `position for ${n.id}`);
      SEGS.push({ x1: gx, y1: gy, x2: p.x, y2: p.y, lit: { kind: 'open', node: n }, branch });
    }
    GATES.push({
      x: gx,
      y: gy,
      node: required(nodes[0], `tier ${tier} node for ${branch}`),
      branch,
    });
  }
}
