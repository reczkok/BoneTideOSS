export type Rgb = readonly [number, number, number];
export type Vec2 = readonly [number, number];

export const rgb = (r: number, g: number, b: number): Rgb => [r, g, b];
export const vec2 = (x: number, y: number): Vec2 => [x, y];
