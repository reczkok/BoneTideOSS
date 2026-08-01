import { SLOT_COUNT, SLOT_LABELS } from '../config.ts';
import type { SlottableId } from './abilities.ts';
import type { Hud } from './hud.ts';
import { abilityIconName } from './icons.ts';
import type { RunStats } from './stats.ts';
import { ABILITY_INFO, SLOTTABLE } from './tree.ts';

export function createLoadout(deps: { stats: RunStats; hud: Hud }) {
  const { stats, hud } = deps;
  const slots: (SlottableId | null)[] = Array.from({ length: SLOT_COUNT }, () => null);

  function pushToHud() {
    for (let i = 0; i < SLOT_COUNT; i++) {
      const id = slots[i];
      hud.setSlot(
        i,
        id ? { key: SLOT_LABELS[i], name: ABILITY_INFO[id].name, icon: abilityIconName(id) } : null,
      );
    }
  }

  function sync() {
    for (let i = 0; i < SLOT_COUNT; i++) {
      const id = slots[i];
      if (id && !stats.unlocked.has(id)) slots[i] = null;
    }
    for (const id of SLOTTABLE) {
      if (!stats.unlocked.has(id) || slots.includes(id)) continue;
      const free = slots.indexOf(null);
      if (free >= 0) slots[free] = id;
    }
    pushToHud();
  }

  return {
    slots: slots as readonly (SlottableId | null)[],
    sync,
    assign(i: number, id: SlottableId) {
      if (i < 0 || i >= SLOT_COUNT) return;
      if (!stats.unlocked.has(id)) return;
      const prev = slots.indexOf(id);
      if (prev >= 0) slots[prev] = null;
      slots[i] = id;
      pushToHud();
    },
    clear(i: number) {
      if (i < 0 || i >= SLOT_COUNT) return;
      slots[i] = null;
      pushToHud();
    },
    canSlot(id: SlottableId) {
      return stats.unlocked.has(id);
    },
    serialize(): (SlottableId | null)[] {
      return [...slots];
    },
    restore(saved: (SlottableId | null)[]) {
      for (let i = 0; i < SLOT_COUNT; i++) slots[i] = saved[i] ?? null;
      sync();
    },
  };
}

export type Loadout = ReturnType<typeof createLoadout>;
