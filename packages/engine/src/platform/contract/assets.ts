export declare function loadBytes(key: string): Promise<Uint8Array>;

export declare function toArrayBuffer(bytes: Uint8Array): ArrayBuffer;

export declare function registryFetch(url: string): Promise<Response>;

export declare function decodeImage(bytes: Uint8Array): Promise<ImageBitmap>;
