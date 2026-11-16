// server/scripts/static-replacement-census-classify-late-batches-b98.ts
// B98 classifier: draft-only / sticker-only lines MTGEDH cannot use, and
// ability-word leftovers that are actually activated (Throw ...).
// Do not list lines this batch only parses if they are not actually wired,
// and do not mark bestow+evidence, blitz extra costs, Pursuit, or Circling Vultures.

export const LATE_BATCH_OTHER_SYSTEMS_B98: Array<[string, RegExp]> = [
  ['draft-noted type or name (Conspiracy draft, not used in MTGEDH)', /(?:a type|an? names?|names?) you noted for cards named\b/i],
  ['ability-sticker grants (Un-stickers, not used in MTGEDH)', /has all abilities of ability stickers\b/i],
  ['ability-word leftover (activated throw/catch cost)', /^throw\s*\.{2,}/i],
];
