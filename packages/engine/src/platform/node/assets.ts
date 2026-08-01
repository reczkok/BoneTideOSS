import { readFile } from 'node:fs/promises';

const ASSET_ROOT = new URL('../../../assets/', import.meta.url);

export async function loadBytes(key: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(new URL(key, ASSET_ROOT)));
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function registryFetch(url: string): Promise<Response> {
  const bytes = await loadBytes(url);
  return {
    ok: true,
    status: 200,
    url,
    arrayBuffer: async () => toArrayBuffer(bytes),
  } as unknown as Response;
}

export function decodeImage(_bytes: Uint8Array): Promise<ImageBitmap> {
  return Promise.reject(new Error('decodeImage is not available in node tests'));
}
