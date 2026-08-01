import { PROGRESS } from '../config.ts';

export function createProgress() {
  let xp = 0;
  let level = 1;
  let pending = 0;

  return {
    get level() {
      return level;
    },
    get frac() {
      return Math.min(1, xp / PROGRESS.xpForLevel(level));
    },
    addXp(amount: number) {
      xp += amount;
      while (xp >= PROGRESS.xpForLevel(level)) {
        xp -= PROGRESS.xpForLevel(level);
        level++;
        pending++;
      }
    },
    consumeLevelUp(): boolean {
      if (pending <= 0) return false;
      pending--;
      return true;
    },
    serialize() {
      return { level, xp };
    },
    restore(saved: { level: number; xp: number }) {
      level = Math.max(1, Math.floor(saved.level));
      xp = Math.max(0, saved.xp);
      pending = 0;
    },
  };
}

export type Progress = ReturnType<typeof createProgress>;
