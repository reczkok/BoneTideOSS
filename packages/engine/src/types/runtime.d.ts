interface ImageBitmap {
  readonly width: number;
  readonly height: number;
  close(): void;
}

interface Response {
  readonly ok: boolean;
  readonly status: number;
  readonly url: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

declare const console: {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
};
