export interface CanvasLike {
  width: number;
  height: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
}

export function guardPresent<T extends { getCurrentTexture(): unknown; present?: () => void }>(
  ctx: T,
  label: string,
): T {
  let acquired = false;
  return new Proxy(ctx, {
    get(target, prop) {
      if (prop === 'getCurrentTexture') {
        return () => {
          acquired = true;
          return target.getCurrentTexture();
        };
      }
      if (prop === 'present' && typeof target.present === 'function') {
        const present = target.present.bind(target);
        return () => {
          if (!acquired) {
            console.warn(`[gpu] ${label}: skipped present without acquire`);
            return;
          }
          acquired = false;
          present();
        };
      }
      const v = Reflect.get(target, prop, target) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  }) as T;
}
