/**
 * Shader idioms shared by every pass and kernel. All plain `'use gpu'`
 * callbacks, so they stay polymorphic and inline into whatever calls them.
 */
import tgpu, { d, std } from 'typegpu';

/** Clip-space position behind the near plane: a vertex placed here is never rasterized. */
export const CULLED_CLIP = d.vec4f(0, 0, -2, 1);

/** Two triangles covering [-1, 1]^2, indexed by `vertexIndex % 6`. */
export const QUAD = tgpu.const(d.arrayOf(d.vec2f, 6), [
  d.vec2f(-1, -1),
  d.vec2f(1, -1),
  d.vec2f(1, 1),
  d.vec2f(-1, -1),
  d.vec2f(1, 1),
  d.vec2f(-1, 1),
]);

/** Corner of the unit quad for a vertex of an instanced 6-vertex quad list. */
export const quadCorner = (vid: number) => {
  'use gpu';
  return d.vec2f(QUAD.$[d.u32(vid) % 6]);
};

export const hash11 = (x: number) => {
  'use gpu';
  return std.fract(std.sin(x * 12.9898) * 43758.547);
};

export const hash21 = (p: d.v2f) => {
  'use gpu';
  return std.fract(std.sin(p.x * 127.1 + p.y * 311.7) * 43758.547);
};

export const hash22 = (p: d.v2f) => {
  'use gpu';
  const h = d.vec2f(std.dot(p, d.vec2f(127.1, 311.7)), std.dot(p, d.vec2f(269.5, 183.3)));
  return std.fract(std.sin(h) * 43758.547);
};

/** Rec. 601 luma, the perceptual weight used for tinting throughout the renderer. */
export const luma = (c: d.v3f) => {
  'use gpu';
  return std.dot(c, d.vec3f(0.299, 0.587, 0.114));
};

/** Schlick-style rim term: 0 facing the viewer, 1 at grazing angles. */
export const fresnel = (n: d.v3f, viewDir: d.v3f, power: number) => {
  'use gpu';
  return std.pow(1 - std.max(std.dot(n, viewDir), 0), d.f32(power));
};

/** Rotates `v` about +Y given the rotation's (cos, sin). */
export const rotateY = (v: d.v3f, cs: d.v2f) => {
  'use gpu';
  return d.vec3f(v.x * cs.x + v.z * cs.y, v.y, -v.x * cs.y + v.z * cs.x);
};

export const yawMatrix = (angle: number) => {
  'use gpu';
  const c = std.cos(angle);
  const s = std.sin(angle);
  return d.mat4x4f(
    d.vec4f(c, 0, -s, 0),
    d.vec4f(0, 1, 0, 0),
    d.vec4f(s, 0, c, 0),
    d.vec4f(0, 0, 0, 1),
  );
};

/** Signed distance of `rel` across a unit direction (positive to its right). */
export const lateral = (rel: d.v2f, dir: d.v2f) => {
  'use gpu';
  return rel.x * dir.y - rel.y * dir.x;
};

/** Unit direction of the (sin, cos) heading convention used for actors. */
export const headingDir = (heading: number) => {
  'use gpu';
  return d.vec2f(std.sin(heading), std.cos(heading));
};

/** (cos, sin) of a heading, the rotation form `rotateY` takes. */
export const headingCS = (heading: number) => {
  'use gpu';
  return d.vec2f(std.cos(heading), std.sin(heading));
};

export const perp = (v: d.v2f) => {
  'use gpu';
  return d.vec2f(-v.y, v.x);
};
