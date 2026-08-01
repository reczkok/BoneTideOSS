import { storage } from '#platform/storage.ts';
import { type Difficulty, SAVE_SLOTS, SLOT_COUNT } from '../config.ts';
import { saturate } from '../core/mathx.ts';
import type { SlottableId } from './abilities.ts';
import { SLOTTABLE } from './tree.ts';

const keyOf = (slot: number) => `bonetide.save.v3.${slot}`;

export interface SaveV3 {
  version: 3;
  savedAt: number;
  wave: number;
  level: number;
  xp: number;
  points: number;
  nodes: Record<string, number>;
  slots: (SlottableId | null)[];
  ultCharge: number;
  hp: number;
  time: number;
  kills: number;
  difficulty: Difficulty;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const num = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

function validSlot(v: unknown): SlottableId | null {
  return typeof v === 'string' && (SLOTTABLE as readonly string[]).includes(v)
    ? (v as SlottableId)
    : null;
}

export function parseSave(json: string | null): SaveV3 | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json ?? 'null');
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.version !== 3) return null;

  const nodes: Record<string, number> = {};
  if (isRecord(raw.nodes)) {
    for (const [id, rank] of Object.entries(raw.nodes)) {
      nodes[id] = Math.max(0, Math.floor(num(rank, 0)));
    }
  }
  const slots = Array.from({ length: SLOT_COUNT }, (_, i) =>
    validSlot(Array.isArray(raw.slots) ? raw.slots[i] : null),
  );

  return {
    version: 3,
    savedAt: Math.max(0, num(raw.savedAt, 0)),
    wave: Math.max(1, Math.floor(num(raw.wave, 1))),
    level: Math.max(1, Math.floor(num(raw.level, 1))),
    xp: Math.max(0, num(raw.xp, 0)),
    points: Math.max(0, Math.floor(num(raw.points, 0))),
    nodes,
    slots,
    ultCharge: saturate(num(raw.ultCharge, 0)),
    hp: Math.max(1, num(raw.hp, 1)),
    time: Math.max(0, num(raw.time, 0)),
    kills: Math.max(0, Math.floor(num(raw.kills, 0))),
    difficulty:
      raw.difficulty === 'easy' || raw.difficulty === 'normal' || raw.difficulty === 'hard'
        ? raw.difficulty
        : 'hard',
  };
}

export function loadSlots(): (SaveV3 | null)[] {
  storage.remove('bonetide.save.v1');
  storage.remove('bonetide.save.v2');
  return Array.from({ length: SAVE_SLOTS }, (_, i) => parseSave(storage.get(keyOf(i))));
}

export function writeSlot(slot: number, save: SaveV3) {
  storage.set(keyOf(slot), JSON.stringify(save));
}

export function clearSlot(slot: number) {
  storage.remove(keyOf(slot));
}
