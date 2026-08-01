const assetUrl = (key: string) => `${import.meta.env.BASE_URL}${key}`;

export async function loadBytes(key: string): Promise<Uint8Array> {
  const res = await fetch(assetUrl(key));
  // SPA hosts (and the Vite dev server) answer a missing file with index.html
  // and a 200; that must read as "absent", or the loader tries to decode
  // HTML as a PNG or GLB.
  const html = (res.headers.get('content-type') ?? '').includes('text/html');
  if (!res.ok || html) throw new Error(`asset missing (${res.status}): ${key}`);
  return new Uint8Array(await res.arrayBuffer());
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function registryFetch(url: string): Promise<Response> {
  return fetch(assetUrl(url));
}

export function decodeImage(bytes: Uint8Array): Promise<ImageBitmap> {
  return createImageBitmap(new Blob([toArrayBuffer(bytes)]), { colorSpaceConversion: 'none' });
}

({
  loadBytes,
  toArrayBuffer,
  registryFetch,
  decodeImage,
}) satisfies typeof import('@bonetide/engine/platform/contract/assets.ts');
