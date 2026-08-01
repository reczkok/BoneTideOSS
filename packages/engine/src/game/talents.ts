import type { Loadout } from './loadout.ts';
import type { Player } from './player.ts';
import type { Modifier, RunStats } from './stats.ts';
import { NODE_BY_ID, TREE, type TreeNode } from './tree.ts';

export function createTalents(deps: { stats: RunStats; player: Player; loadout: Loadout }) {
  const { stats, player, loadout } = deps;
  let points = 0;
  const spent = new Map<string, number>();

  const ranks = (id: string) => spent.get(id) ?? 0;
  const tierOpen = (node: TreeNode) =>
    node.tier === 1 ||
    TREE.some((n) => n.branch === node.branch && n.tier === node.tier - 1 && ranks(n.id) > 0);
  const canBuy = (node: TreeNode) =>
    points >= 1 && ranks(node.id) < node.maxRanks && tierOpen(node);

  function reapply() {
    const mods: Modifier[] = [];
    for (const [id, r] of spent) mods.push(...(NODE_BY_ID.get(id)?.mods(r) ?? []));
    stats.apply(mods);
    loadout.sync();
  }

  return {
    get points() {
      return points;
    },
    ranks,
    tierOpen,
    canBuy,
    grantPoint(n = 1) {
      points += n;
    },
    buy(id: string) {
      const node = NODE_BY_ID.get(id);
      if (!node || !canBuy(node)) return false;
      points--;
      spent.set(id, ranks(id) + 1);
      reapply();
      if (node.onBuy === 'heal25') player.heal(25);
      return true;
    },
    reapply,
    serialize: () => ({ points, nodes: Object.fromEntries(spent) }),
    restore(data: { points: number; nodes: Record<string, number> }) {
      points = Math.max(0, data.points);
      spent.clear();
      for (const [id, r] of Object.entries(data.nodes)) {
        const node = NODE_BY_ID.get(id);
        if (node) spent.set(id, Math.max(0, Math.min(Math.floor(r), node.maxRanks)));
        else points += Math.max(0, Math.floor(r));
      }
      reapply();
    },
  };
}

export type Talents = ReturnType<typeof createTalents>;
