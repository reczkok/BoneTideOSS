export function createFrameCadence(maxFps: number) {
  const interval = maxFps > 0 ? 1 / maxFps : 0;
  let pending = 0;
  let invalidated = true;

  return {
    invalidate() {
      invalidated = true;
    },
    tick(dt: number): number | null {
      pending += Math.max(0, dt);
      if (!invalidated && interval > 0 && pending + 1e-9 < interval) return null;
      const elapsed = pending;
      pending = 0;
      invalidated = false;
      return elapsed;
    },
  };
}
