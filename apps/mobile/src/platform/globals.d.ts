declare const __DEV__: boolean;

interface ImageBitmap {
  readonly width: number;
  readonly height: number;
  close(): void;
}
