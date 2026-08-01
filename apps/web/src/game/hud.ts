import type { VitalsOrbs } from '../renderer/vitals.ts';
import { ABILITY_ICONS, BOOK_ICON, DASH_ICON, SKULL_ICON } from '@bonetide/engine/game/icons.ts';
import { formatTime, type Hud, type HudFrame, type HudSlot } from '@bonetide/engine/game/hud.ts';

export { formatTime, type Hud, type HudFrame, type HudSlot };

const iconSvg = (name: string) =>
  ABILITY_ICONS[name.replace(/^ability-/, '') as keyof typeof ABILITY_ICONS] ?? '';

interface ActionEl {
  el: HTMLButtonElement;
  key: HTMLElement;
  name: HTMLElement;
  icon: HTMLElement;
  lastReady?: boolean | undefined;
  lastCd?: number | undefined;
}

export function createHud(
  screenFx: (flash: number, hurt: number) => void,
  vitals: VitalsOrbs,
): Hud {
  const get = (id: string) => document.getElementById(id) as HTMLElement;
  const waveLabel = get('wave-label');
  const timer = get('timer');
  const killsN = get('kills-n');
  get('kills-icon').innerHTML = SKULL_ICON;
  const levelLabel = get('level-label');
  const spellbookBtn = get('spellbook-btn');
  const spellbookPoints = get('spellbook-points');
  get('spellbook-icon').innerHTML = BOOK_ICON;
  const bannerEl = get('banner');
  const bossBar = get('boss-bar');
  const bossFill = get('boss-fill');
  const goStats = get('go-stats');

  const actions = new Map<string, ActionEl>();
  for (const el of document.querySelectorAll<HTMLButtonElement>('#actionbar [data-action]')) {
    actions.set(el.dataset['action'] as string, {
      el,
      key: el.querySelector('.act-key') as HTMLElement,
      name: el.querySelector('.act-name') as HTMLElement,
      icon: el.querySelector('.act-icon') as HTMLElement,
    });
  }
  const ult = actions.get('ult') as ActionEl;
  ult.icon.innerHTML = ABILITY_ICONS.nova;
  (actions.get('dash') as ActionEl).icon.innerHTML = DASH_ICON;
  const lockedByDefault = new Set(
    [...actions].filter(([, a]) => a.el.classList.contains('locked')).map(([name]) => name),
  );

  let vignetteHeat = 0;
  let flashAmp = 0;
  const lastHud = { charge: -1, level: -1, kills: -1, timeSec: -1, points: -1 };
  let lastBossFrac = -1;
  const invalidate = () => {
    lastHud.charge = -1;
    lastHud.level = -1;
    lastHud.kills = -1;
    lastHud.timeSec = -1;
    lastHud.points = -1;
    for (const [, a] of actions) {
      a.lastReady = undefined;
      a.lastCd = undefined;
    }
  };

  return {
    reset() {
      invalidate();
      waveLabel.textContent = 'WAVE 1';
      timer.textContent = '0:00';
      killsN.textContent = '0';
      levelLabel.textContent = 'LV 1';
      spellbookBtn.classList.remove('has-points', 'flare');
      spellbookPoints.classList.add('hidden');
      vitals.reset();
      ult.el.style.setProperty('--charge', '0');
      bannerEl.classList.add('hidden');
      lastBossFrac = -1;
      bossBar.classList.add('hidden');
      for (const [name, a] of actions) {
        const locked = lockedByDefault.has(name);
        a.el.classList.toggle('locked', locked);
        a.el.disabled = locked;
        a.el.classList.remove('ready', 'cooling');
        a.el.style.setProperty('--cd', '0');
        if (locked) a.name.textContent = '';
      }
      vignetteHeat = 0;
      flashAmp = 0;
      screenFx(0, 0);
    },
    setWave(n: number) {
      waveLabel.textContent = `WAVE ${n}`;
    },
    setBoss(frac: number) {
      if (frac === lastBossFrac) return;
      lastBossFrac = frac;
      bossBar.classList.toggle('hidden', frac < 0);
      if (frac >= 0) bossFill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    },
    banner(text: string, ms = 2200) {
      bannerEl.textContent = text;
      bannerEl.classList.remove('hidden');
      setTimeout(() => bannerEl.classList.add('hidden'), ms);
    },
    setGameOverStats(stats: string) {
      goStats.textContent = stats;
    },
    setSlot(i: number, slot: HudSlot | null) {
      const a = actions.get(`slot${i}`);
      if (!a) return;
      if (slot) a.key.textContent = slot.key;
      a.name.textContent = slot?.name ?? '';
      a.icon.innerHTML = slot ? iconSvg(slot.icon) : '';
      a.el.classList.toggle('locked', slot === null);
      a.el.disabled = slot === null;
      a.lastReady = undefined;
      a.lastCd = undefined;
      if (slot === null) {
        a.el.classList.remove('ready', 'cooling');
        a.el.style.setProperty('--cd', '0');
      }
    },
    heat(amount: number) {
      vignetteHeat = Math.min(1, vignetteHeat + amount);
      vitals.surgeHp(Math.min(1, amount));
    },
    flash(amount: number) {
      flashAmp = Math.max(flashAmp, amount);
    },
    spellbookFlare(on: boolean) {
      spellbookBtn.classList.toggle('flare', on);
    },
    update(dt: number, frame: HudFrame) {
      vitals.set(frame.hp / frame.maxHp, frame.xpFrac);
      const charge = Math.max(0, Math.min(1, frame.ultCharge));
      const ultReady = charge >= 1;
      if (charge !== lastHud.charge) {
        lastHud.charge = charge;
        ult.el.style.setProperty('--charge', charge.toFixed(3));
      }
      if (frame.level !== lastHud.level) {
        if (lastHud.level > 0 && frame.level > lastHud.level) vitals.surgeXp();
        lastHud.level = frame.level;
        levelLabel.textContent = `LV ${frame.level}`;
      }
      if (frame.points !== lastHud.points) {
        lastHud.points = frame.points;
        spellbookPoints.textContent = String(frame.points);
        spellbookPoints.classList.toggle('hidden', frame.points === 0);
        spellbookBtn.classList.toggle('has-points', frame.points > 0);
      }
      if (frame.kills !== lastHud.kills) {
        lastHud.kills = frame.kills;
        killsN.textContent = String(frame.kills);
      }
      const timeSec = Math.floor(frame.time);
      if (timeSec !== lastHud.timeSec) {
        lastHud.timeSec = timeSec;
        timer.textContent = formatTime(frame.time);
      }
      for (const [name, a] of actions) {
        if (a.el.classList.contains('locked')) continue;
        const ready = name === 'ult' ? ultReady : frame.ready[name] === true;
        if (a.lastReady !== ready) {
          a.lastReady = ready;
          a.el.classList.toggle('ready', ready);
          a.el.classList.toggle('cooling', !ready);
        }
        if (name !== 'ult') {
          const cd = Math.round(Math.max(0, Math.min(1, frame.cooldown[name] ?? 0)) * 100) / 100;
          if (a.lastCd !== cd) {
            a.lastCd = cd;
            a.el.style.setProperty('--cd', String(cd));
          }
        }
      }
      vignetteHeat = Math.max(0, vignetteHeat - 0.9 * dt);
      const glow = vignetteHeat * 0.85 + (frame.hp < 30 && frame.alive ? 0.25 : 0);
      flashAmp *= Math.exp(-9 * dt);
      screenFx(flashAmp < 0.01 ? 0 : flashAmp, glow);
    },
  };
}
