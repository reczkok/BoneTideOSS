import { TOUCH } from '@bonetide/engine/config.ts';
import type { Action, Input } from './input.ts';

export function createTouchControls(deps: {
  input: Input;
  canvas: HTMLCanvasElement;
  onPause(): void;
}) {
  const { input, canvas } = deps;
  const active = matchMedia('(pointer: coarse)').matches;
  if (!active) return { active };

  const stick = document.getElementById('touch-stick');
  const knob = document.getElementById('touch-stick-knob');
  let stickPointer = -1;
  const stickCenter = { x: 0, y: 0, max: 1 };

  function cacheStickRect() {
    if (!stick) return;
    const rect = stick.getBoundingClientRect();
    stickCenter.x = rect.left + rect.width / 2;
    stickCenter.y = rect.top + rect.height / 2;
    stickCenter.max = Math.max(1, rect.width * TOUCH.stickTravel);
  }

  function placeStick(e: PointerEvent) {
    if (!stick) return;
    const size = stick.offsetWidth || TOUCH.stickSize;
    const margin = TOUCH.stickMargin;
    const left = Math.max(
      margin,
      Math.min(window.innerWidth - size - margin, e.clientX - size / 2),
    );
    const top = Math.max(
      margin,
      Math.min(window.innerHeight - size - margin, e.clientY - size / 2),
    );
    stick.style.left = `${left}px`;
    stick.style.top = `${top}px`;
    stick.style.bottom = 'auto';
  }

  function updateStick(e: PointerEvent) {
    if (!stick || !knob) return;
    const max = stickCenter.max;
    const rawX = e.clientX - stickCenter.x;
    const rawY = e.clientY - stickCenter.y;
    const len = Math.hypot(rawX, rawY);
    const scale = len > max ? max / len : 1;
    const x = rawX * scale;
    const y = rawY * scale;
    input.setVirtualMove(x / max, y / max);
    knob.style.transform = `translate(${x}px, ${y}px)`;
  }

  function resetStick() {
    stickPointer = -1;
    input.setVirtualMove(0, 0);
    stick?.classList.remove('active');
    if (stick) {
      stick.style.left = '';
      stick.style.top = '';
      stick.style.bottom = '';
    }
    if (knob) knob.style.transform = '';
  }

  function startStick(e: PointerEvent) {
    e.preventDefault();
    placeStick(e);
    cacheStickRect();
    stickPointer = e.pointerId;
    stick?.classList.add('active');
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {}
    updateStick(e);
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') startStick(e);
  });
  stick?.addEventListener('pointerdown', startStick);
  window.addEventListener('pointermove', (e) => {
    if (e.pointerId === stickPointer) updateStick(e);
  });
  window.addEventListener('pointerup', (e) => {
    if (e.pointerId === stickPointer) resetStick();
  });
  window.addEventListener('pointercancel', (e) => {
    if (e.pointerId === stickPointer) resetStick();
  });
  stick?.addEventListener('pointercancel', resetStick);

  for (const btn of document.querySelectorAll<HTMLButtonElement>('#actionbar [data-action]')) {
    btn.addEventListener('pointerdown', (e) => {
      if (btn.disabled) return;
      e.preventDefault();
      e.stopPropagation();
      input.queue(btn.dataset['action'] as Action);
    });
  }

  document.getElementById('touch-pause')?.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    deps.onPause();
  });

  return { active };
}

export type TouchControls = ReturnType<typeof createTouchControls>;
