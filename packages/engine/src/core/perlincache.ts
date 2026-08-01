import { perlin2d } from '@typegpu/noise';
import { d, type TgpuRoot, type WithBinding } from 'typegpu';

const CACHE_SIZE = 256;
const caches = new WeakMap<TgpuRoot, WithBinding>();

export function perlinRoot(root: TgpuRoot) {
  let piped = caches.get(root);
  if (!piped) {
    piped = root.pipe(
      perlin2d.staticCache({ root, size: d.vec2u(CACHE_SIZE, CACHE_SIZE) }).inject(),
    );
    caches.set(root, piped);
  }
  return piped;
}
