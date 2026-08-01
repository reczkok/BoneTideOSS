import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';

export const ASSET_MODULES: Record<string, number> = {};

export async function loadBytes(key: string): Promise<Uint8Array> {
  const mod = ASSET_MODULES[key];
  if (mod === undefined) throw new Error(`unknown asset: ${key}`);
  const asset = Asset.fromModule(mod);
  if (!asset.localUri?.startsWith('file://')) {
    asset.downloaded = false;
    asset.localUri = null;
    await asset.downloadAsync();
  }
  if (!asset.localUri) throw new Error(`asset has no local uri: ${key}`);
  return new File(asset.localUri).bytes();
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

export function decodeImage(bytes: Uint8Array): Promise<ImageBitmap> {
  return (
    globalThis as unknown as { createImageBitmap(b: Uint8Array): Promise<ImageBitmap> }
  ).createImageBitmap(bytes);
}

({
  loadBytes,
  toArrayBuffer,
  registryFetch,
  decodeImage,
}) satisfies typeof import('@bonetide/engine/platform/contract/assets.ts');
