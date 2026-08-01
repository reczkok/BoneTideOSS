import type { Renderer } from './renderer.ts';

export interface RendererHandle extends Renderer {
  /** Destroys the current renderer and builds a fresh one; every forwarded method keeps working. */
  rebuild(): void;
}

/**
 * A stable façade over a rebuildable renderer. Consumers capture methods
 * (`emit`, `light`, ...) at wiring time, so each one forwards to whichever
 * renderer is current; property reads (`camera`, `fx`) resolve the same way.
 */
export function createRendererHandle(create: () => Renderer): RendererHandle {
  let current = create();
  const forwarded = new Map<PropertyKey, (...args: unknown[]) => unknown>();

  return new Proxy({} as RendererHandle, {
    get(_target, key) {
      if (key === 'rebuild') {
        return () => {
          current.destroy();
          current = create();
        };
      }
      const value = current[key as keyof Renderer];
      if (typeof value !== 'function') return value;
      let fn = forwarded.get(key);
      if (!fn) {
        fn = (...args) => (current[key as keyof Renderer] as (...a: unknown[]) => unknown)(...args);
        forwarded.set(key, fn);
      }
      return fn;
    },
  });
}
