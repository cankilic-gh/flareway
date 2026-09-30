/** Deterministic seeded helpers. No Math.random anywhere in the simulation. */

export const hash32 = (a: number, b = 0): number => {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
};

export type Rng = () => number;

/** mulberry32: small, fast, well distributed for gameplay use. */
export const createRng = (seed: number): Rng => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const range = (rng: Rng, min: number, max: number): number => min + (max - min) * rng();

/** Lattice value in [-1, 1]. */
const lattice = (seed: number, i: number): number => hash32(seed, i) / 2147483647.5 - 1;

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/** Smooth 1D value noise in roughly [-1, 1], C2 continuous. */
export const noise1 = (seed: number, x: number): number => {
  const i = Math.floor(x);
  const f = x - i;
  const a = lattice(seed, i);
  const b = lattice(seed, i + 1);
  return a + (b - a) * fade(f);
};

/** Two-octave smooth noise normalized to roughly [-1, 1]. */
export const fbm1 = (seed: number, x: number): number =>
  (noise1(seed, x) + 0.5 * noise1(seed ^ 0x5bd1e995, x * 2.03 + 17.1)) / 1.5;
