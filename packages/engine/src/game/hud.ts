export function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export interface HudFrame {
  hp: number;
  maxHp: number;
  alive: boolean;
  kills: number;
  time: number;
  level: number;
  xpFrac: number;
  ultCharge: number;
  points: number;
  ready: Record<string, boolean>;
  cooldown: Record<string, number>;
}

export interface HudSlot {
  key: string;
  name: string;
  icon: string;
}

export interface Hud {
  reset(): void;
  setWave(n: number): void;
  setBoss(frac: number): void;
  banner(text: string, ms?: number): void;
  setGameOverStats(stats: string): void;
  setSlot(i: number, slot: HudSlot | null): void;
  heat(amount: number): void;
  flash(amount: number): void;
  spellbookFlare(on: boolean): void;
  update(dt: number, frame: HudFrame): void;
}
