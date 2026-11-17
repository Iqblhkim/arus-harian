/**
 * Deterministic RNG for Arus Harian.
 *
 * The daily maze is derived from the date string alone, so every player in
 * the world sees the same maze on the same day. FNV-1a turns the date into a
 * 32-bit seed; mulberry32 turns the seed into a uniform [0, 1) stream.
 *
 * Pure functions, no platform dependencies — safe to run in the browser,
 * on the Devvit server, and in tests.
 */

/** FNV-1a 32-bit hash. Offset basis 2166136261, prime 16777619. */
export function fnv1a(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // Math.imul keeps the multiply in 32-bit signed arithmetic.
    hash = Math.imul(hash, 16777619);
  }
  // >>> 0 converts to an unsigned 32-bit integer.
  return hash >>> 0;
}

/**
 * mulberry32 — small, fast, deterministic PRNG.
 * Returns a function producing uniform numbers in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [0, max) from a mulberry32 stream. */
export function nextInt(rng: () => number, max: number): number {
  return Math.floor(rng() * max);
}
