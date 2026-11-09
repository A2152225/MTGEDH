/**
 * Seeded RNG for AI decisions.
 *
 * Origin: AI_Upgrade Phase 0-1 (P0-3).
 * Public entry symbols: aiRandom, seedAIRandom, getAIRandomSeed.
 *
 * Live games keep Math.random as the default. The self-play harness calls
 * seedAIRandom(gameSeed) so two runs of one seed match.
 */

let impl: () => number = Math.random;
let currentSeed: number | null = null;

/** Drop-in for Math.random() in AI decision code. */
export function aiRandom(): number {
  return impl();
}

/**
 * Seed AI randomness with a mulberry32 PRNG.
 * Pass null/undefined to restore Math.random (live-game default).
 */
export function seedAIRandom(seed: number | null | undefined): void {
  if (seed == null || !Number.isFinite(seed)) {
    impl = Math.random;
    currentSeed = null;
    return;
  }
  currentSeed = seed >>> 0;
  let t = currentSeed;
  impl = () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Current seed when seeded; null when using Math.random. */
export function getAIRandomSeed(): number | null {
  return currentSeed;
}
