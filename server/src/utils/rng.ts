// Deterministic RNG utilities

// Simple fast PRNG suitable for reproducible shuffles.
// Returns a function that yields floats in [0, 1).
// IMPORTANT: This implementation must match the inline versions in context.ts 
// and applyEvent.ts exactly for deterministic replay to work correctly.
export function mulberry32(seed: number) {
  let t = seed >>> 0;
  return function next() {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Stable non-crypto hash -> 32-bit unsigned seed
export function hashStringToSeed(s: string): number {
  let h = 2166136261 >>> 0; // FNV-1a basis
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}