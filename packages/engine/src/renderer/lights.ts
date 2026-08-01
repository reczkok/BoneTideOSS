import { d, type TgpuRoot } from 'typegpu';
import type { Rgb } from '../config/types.ts';
import { MAX_POINT_LIGHTS, PointLight } from '../core/schemas.ts';

export interface LightSpec {
  x: number;
  y: number;
  z: number;
  color: Rgb;
  radius: number;
  life: number;
}

export interface SteadyLightSpec {
  x: number;
  y: number;
  z: number;
  color: Rgb;
  radius: number;
}

/**
 * Packs keyed steady lights plus fading transient lights into the fixed
 * point-light uniform, newest transients first so bursts win the slots.
 */
export function createPointLights(root: TgpuRoot) {
  const buffer = root.createUniform(d.arrayOf(PointLight, MAX_POINT_LIGHTS));
  const countBuffer = root.createUniform(d.u32, 0);
  const transient: (LightSpec & { maxLife: number })[] = [];
  const steady = new Map<string, SteadyLightSpec>();
  const packed: d.InferInput<typeof PointLight>[] = Array.from(
    { length: MAX_POINT_LIGHTS },
    () => ({
      pos: [0, 0, 0],
      color: [0, 0, 0],
      radius: 0,
    }),
  );
  let lastCount = -1;

  const pack = (n: number, s: SteadyLightSpec, fade: number) => {
    const slot = packed[n];
    slot.pos = [s.x, s.y, s.z];
    slot.color = [s.color[0] * fade, s.color[1] * fade, s.color[2] * fade];
    slot.radius = s.radius;
  };

  return {
    buffer,
    countBuffer,
    add(spec: LightSpec) {
      transient.push({ ...spec, maxLife: spec.life });
    },
    setSteady(key: string, spec: SteadyLightSpec | null) {
      if (spec) steady.set(key, spec);
      else steady.delete(key);
    },
    clear() {
      transient.length = 0;
      steady.clear();
    },
    update(dt: number) {
      for (let i = transient.length - 1; i >= 0; i--) {
        transient[i].life -= dt;
        if (transient[i].life <= 0) transient.splice(i, 1);
      }
      let n = 0;
      for (const s of steady.values()) {
        if (n >= MAX_POINT_LIGHTS) break;
        pack(n++, s, 1);
      }
      for (let i = transient.length - 1; i >= 0 && n < MAX_POINT_LIGHTS; i--) {
        const src = transient[i];
        const k = src.life / src.maxLife;
        pack(n++, src, k * k);
      }
      for (let i = n; i < MAX_POINT_LIGHTS; i++) packed[i].radius = 0;
      if (n === 0 && lastCount === 0) return;
      if (n !== lastCount) countBuffer.write(n);
      lastCount = n;
      buffer.write(packed);
    },
  };
}
