import type { Hud, HudFrame, HudSlot } from '@bonetide/engine/game/hud.ts';

export interface HudSnapshot {
  wave: number;
  time: number;
  kills: number;
  level: number;
  points: number;
  hp: number;
  maxHp: number;
  xpFrac: number;
  ultCharge: number;
  boss: number;
  banner: string;
  gameOver: string;
  slots: (HudSlot | null)[];
  ready: Record<string, boolean>;
}

const emptySnapshot = (): HudSnapshot => ({
  wave: 1,
  time: 0,
  kills: 0,
  level: 1,
  points: 0,
  hp: 1,
  maxHp: 1,
  xpFrac: 0,
  ultCharge: 0,
  boss: -1,
  banner: '',
  gameOver: '',
  slots: [null, null, null, null, null],
  ready: {},
});

const STEPS = 20;
const quantize = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * STEPS) / STEPS;

export function createHudBridge() {
  let snapshot = emptySnapshot();
  const listeners = new Set<() => void>();
  let bannerTimer: ReturnType<typeof setTimeout> | undefined;

  const publish = (next: Partial<HudSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    for (const listener of listeners) listener();
  };

  const hud: Hud = {
    reset() {
      clearTimeout(bannerTimer);
      publish(emptySnapshot());
    },
    setWave(n) {
      if (n !== snapshot.wave) publish({ wave: n });
    },
    setBoss(frac) {
      const boss = Number.isFinite(frac) ? frac : -1;
      if (quantize(boss) !== quantize(snapshot.boss)) publish({ boss });
    },
    banner(text, ms = 2200) {
      clearTimeout(bannerTimer);
      publish({ banner: text });
      bannerTimer = setTimeout(() => publish({ banner: '' }), ms);
    },
    setGameOverStats(stats) {
      publish({ gameOver: stats });
    },
    setSlot(i, slot) {
      const slots = [...snapshot.slots];
      slots[i] = slot;
      publish({ slots });
    },
    heat() {},
    flash() {},
    spellbookFlare() {},
    update(_dt: number, frame: HudFrame) {
      const time = Math.floor(frame.time);
      const hp = quantize(frame.hp / Math.max(1, frame.maxHp)) * frame.maxHp;
      const xpFrac = quantize(frame.xpFrac);
      const ultCharge = quantize(frame.ultCharge);
      const readyChanged = Object.keys(frame.ready).some(
        (key) => frame.ready[key] !== snapshot.ready[key],
      );
      if (
        time === snapshot.time &&
        frame.kills === snapshot.kills &&
        frame.level === snapshot.level &&
        frame.points === snapshot.points &&
        hp === snapshot.hp &&
        frame.maxHp === snapshot.maxHp &&
        xpFrac === snapshot.xpFrac &&
        ultCharge === snapshot.ultCharge &&
        !readyChanged
      ) {
        return;
      }
      publish({
        time,
        kills: frame.kills,
        level: frame.level,
        points: frame.points,
        hp,
        maxHp: frame.maxHp,
        xpFrac,
        ultCharge,
        ready: { ...frame.ready },
      });
    },
  };

  return {
    hud,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type HudBridge = ReturnType<typeof createHudBridge>;
