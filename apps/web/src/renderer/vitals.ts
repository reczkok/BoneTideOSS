import type { TgpuRoot } from 'typegpu';
import { DPR } from '@bonetide/engine/config.ts';
import { createVitalsCore } from '@bonetide/engine/renderer/vitals.ts';

export function createVitalsOrbs(root: TgpuRoot) {
  const core = createVitalsCore(root, navigator.gpu.getPreferredCanvasFormat());

  function makeCanvas(id: string) {
    const canvas = document.getElementById(id) as HTMLCanvasElement;
    const ctx = root.configureContext({ canvas, alphaMode: 'premultiplied' });
    new ResizeObserver((entries) => {
      const box = entries[0].contentBoxSize[0];
      const scale = Math.min(window.devicePixelRatio, DPR.vitalsCap);
      const w = Math.round(box.inlineSize * scale);
      if (w < 4) return;
      canvas.width = w;
      canvas.height = Math.max(4, Math.round(box.blockSize * scale));
      core.invalidate();
    }).observe(canvas);
    return { canvas, ctx };
  }

  const hp = makeCanvas('orb-hp');
  const xp = makeCanvas('orb-xp');

  return {
    set: core.set,
    surgeHp: core.surgeHp,
    surgeXp: core.surgeXp,
    reset: core.reset,
    render(dt: number, enc: GPUCommandEncoder) {
      if (!core.tick(dt)) return;
      if (hp.canvas.width >= 4 && hp.canvas.clientWidth !== 0) core.draw(core.hp, enc, hp.ctx);
      if (xp.canvas.width >= 4 && xp.canvas.clientWidth !== 0) core.draw(core.xp, enc, xp.ctx);
    },
  };
}

export type VitalsOrbs = ReturnType<typeof createVitalsOrbs>;
