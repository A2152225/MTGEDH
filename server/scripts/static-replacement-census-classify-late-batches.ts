/**
 * B48+: census classifier entries for later batches (kept out of static-replacement-census-classify.ts for size).
 * Lines are lowercased with the card name replaced by "~" before matching. Add new batches at the top of the newest range module.
 */
import { LATE_BATCH_OTHER_SYSTEMS_B100 } from './static-replacement-census-classify-late-batches-b100.js';
import { LATE_BATCH_OTHER_SYSTEMS_B103 } from './static-replacement-census-classify-late-batches-b103.js';
import { LATE_BATCH_OTHER_SYSTEMS_B104 } from './static-replacement-census-classify-late-batches-b104.js';
import { LATE_BATCH_OTHER_SYSTEMS_B105 } from './static-replacement-census-classify-late-batches-b105.js';
import { LATE_BATCH_OTHER_SYSTEMS_B106 } from './static-replacement-census-classify-late-batches-b106.js';
import { LATE_BATCH_OTHER_SYSTEMS_B107 } from './static-replacement-census-classify-late-batches-b107.js';
import { LATE_BATCH_OTHER_SYSTEMS_B109 } from './static-replacement-census-classify-late-batches-b109.js';
import { LATE_BATCH_OTHER_SYSTEMS_B101 } from './static-replacement-census-classify-late-batches-b101.js';
import { LATE_BATCH_OTHER_SYSTEMS_B102 } from './static-replacement-census-classify-late-batches-b102.js';
import { LATE_BATCH_OTHER_SYSTEMS_B96 } from './static-replacement-census-classify-late-batches-b96.js';
import { LATE_BATCH_OTHER_SYSTEMS_B98 } from './static-replacement-census-classify-late-batches-b98.js';
import { LATE_BATCH_OTHER_SYSTEMS_B99 } from './static-replacement-census-classify-late-batches-b99.js';
import { LATE_BATCH_OTHER_SYSTEMS_B97 } from './static-replacement-census-classify-late-batches-b97.js';
import { LATE_BATCH_OTHER_SYSTEMS_B95 } from './static-replacement-census-classify-late-batches-b95.js';
import { LATE_BATCH_OTHER_SYSTEMS_B94 } from './static-replacement-census-classify-late-batches-b94.js';
import { LATE_BATCH_OTHER_SYSTEMS_B91_B93 } from './static-replacement-census-classify-late-batches-b91-b93.js';
import { LATE_BATCH_OTHER_SYSTEMS_B80_B90 } from './static-replacement-census-classify-late-batches-b80-b90.js';
import { LATE_BATCH_OTHER_SYSTEMS_B70_B79 } from './static-replacement-census-classify-late-batches-b70-b79.js';
import { LATE_BATCH_OTHER_SYSTEMS_B48_B69 } from './static-replacement-census-classify-late-batches-b48-b69.js';

export const LATE_BATCH_OTHER_SYSTEMS: Array<[string, RegExp]> = [

  ...LATE_BATCH_OTHER_SYSTEMS_B109, ...LATE_BATCH_OTHER_SYSTEMS_B107, ...LATE_BATCH_OTHER_SYSTEMS_B106,  ...LATE_BATCH_OTHER_SYSTEMS_B105,
  ...LATE_BATCH_OTHER_SYSTEMS_B104,
  ...LATE_BATCH_OTHER_SYSTEMS_B103,
  ...LATE_BATCH_OTHER_SYSTEMS_B102,
  ...LATE_BATCH_OTHER_SYSTEMS_B101,
  ...LATE_BATCH_OTHER_SYSTEMS_B100,
  ...LATE_BATCH_OTHER_SYSTEMS_B98,
  ...LATE_BATCH_OTHER_SYSTEMS_B99,
  ...LATE_BATCH_OTHER_SYSTEMS_B97,
  ...LATE_BATCH_OTHER_SYSTEMS_B96,
  ...LATE_BATCH_OTHER_SYSTEMS_B95,
  ...LATE_BATCH_OTHER_SYSTEMS_B94,
  ...LATE_BATCH_OTHER_SYSTEMS_B91_B93,
  ...LATE_BATCH_OTHER_SYSTEMS_B80_B90,
  ...LATE_BATCH_OTHER_SYSTEMS_B70_B79,
  ...LATE_BATCH_OTHER_SYSTEMS_B48_B69,
];
