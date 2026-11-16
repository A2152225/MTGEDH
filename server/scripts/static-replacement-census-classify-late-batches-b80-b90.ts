/**
 * B80–B90 census classifier entries (split from static-replacement-census-classify-late-batches.ts).
 * Lines are lowercased with the card name replaced by "~" before matching.
 * Split into token-extras + B91–B92, B85–B90, and B80–B84 modules for size.
 */
import { LATE_BATCH_OTHER_SYSTEMS_TOKEN_EXTRAS_B91_B92 } from './static-replacement-census-classify-late-batches-token-extras-b91-b92.js';
import { LATE_BATCH_OTHER_SYSTEMS_B85_B90 } from './static-replacement-census-classify-late-batches-b85-b90.js';
import { LATE_BATCH_OTHER_SYSTEMS_B80_B84 } from './static-replacement-census-classify-late-batches-b80-b84.js';

export const LATE_BATCH_OTHER_SYSTEMS_B80_B90: Array<[string, RegExp]> = [
  ...LATE_BATCH_OTHER_SYSTEMS_TOKEN_EXTRAS_B91_B92,
  ...LATE_BATCH_OTHER_SYSTEMS_B85_B90,
  ...LATE_BATCH_OTHER_SYSTEMS_B80_B84,
];
