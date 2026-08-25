// Chat C: merge leftover detectDeathTriggers into triggers/, split under 40KB.
// Byte-exact bodies. One snapshot. Writes all files then splices leftover + zone-changes.
import fs from 'node:fs';
import path from 'node:path';

const leftoverPath = 'server/src/state/modules/triggered-abilities.ts';
const zonePath = 'server/src/state/modules/triggers/zone-changes.ts';
const dry = process.argv.includes('--dry');

function lineStartsOf(buf) {
  const starts = [0];
  for (let i = 0; i < buf.length; i += 1) {
    if (buf[i] === 0x0a) starts.push(i + 1);
  }
  return starts;
}

function sliceLines(buf, starts, from, toInclusive) {
  const a = starts[from - 1];
  const b = toInclusive < starts.length ? starts[toInclusive] : buf.length;
  return buf.subarray(a, b);
}

function toLf(text) {
  return text.replace(/\r\n/g, '\n');
}

function toCrlf(text) {
  return toLf(text).replace(/\n/g, '\r\n');
}

const leftover = fs.readFileSync(leftoverPath);
const leftoverStarts = lineStartsOf(leftover);
const leftoverLines = leftover.toString('utf8').split('\n');

// Current leftover ranges (after helper extracts).
const COLLECT_START = 2542;
const COLLECT_END = 2573;
const ENTERS_START = 2575;
const ENTERS_END = 2576;
const FN_START = 2578; // JSDoc
const FN_SIG = 2593;
const PROLOGUE_START = 2594;
const PROLOGUE_END = 2668;
const EARLY_START = 2670;
const EARLY_END = 3511;
const MID_START = 3513;
const MID_END = 4356;
const LATE_START = 4358;
const LATE_END = 5011;
const CLUSTER_END = 5014; // through closing `}` of detectDeathTriggers

function expectLine(n, re, label) {
  const line = leftoverLines[n - 1] ?? '';
  if (!re.test(line)) {
    console.error(`boundary fail ${label}: line ${n} = ${JSON.stringify(line)}`);
    process.exit(1);
  }
}

expectLine(COLLECT_START, /^function collectDeathTriggerEffectText/, 'collect');
expectLine(ENTERS_START, /Optional "enters or"/, 'enters comment');
expectLine(FN_SIG, /^export function detectDeathTriggers/, 'detectDeath');
expectLine(PROLOGUE_END, /^\s+\];$/, 'prologue end');
expectLine(EARLY_START, /const attacksOrDiesPattern/, 'early start');
expectLine(EARLY_END, /^\s+\}$/, 'early end');
expectLine(MID_START, /const permanentCardsYourGyWhileMatch/, 'mid start');
expectLine(MID_END, /^\s+\}$/, 'mid end');
expectLine(LATE_START, /const graveyardZoneDiesPattern/, 'late start');
expectLine(LATE_END, /^\s+\}$/, 'late end');
expectLine(CLUSTER_END, /^\}$/, 'cluster end');

const collectBytes = sliceLines(leftover, leftoverStarts, COLLECT_START, COLLECT_END);
const entersBytes = sliceLines(leftover, leftoverStarts, ENTERS_START, ENTERS_END);
const jsdocBytes = sliceLines(leftover, leftoverStarts, FN_START, FN_SIG);
const prologueBytes = sliceLines(leftover, leftoverStarts, PROLOGUE_START, PROLOGUE_END);
const earlyBytes = sliceLines(leftover, leftoverStarts, EARLY_START, EARLY_END);
const midBytes = sliceLines(leftover, leftoverStarts, MID_START, MID_END);
const lateBytes = sliceLines(leftover, leftoverStarts, LATE_START, LATE_END);

const stateFile = `/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: shared locals for leftover detectDeathTriggers split
 * Public: DeathDetectionState
 */

import type { TriggeredAbility } from "./detectorTriggeredAbility.js";

export interface DeathDetectionState {
  triggers: TriggeredAbility[];
  oracleText: string;
  lowerOracle: string;
  cardName: string;
  lowerName: string;
  permanentId: string;
  counters: any;
  dieNameVariants: string[];
  dieSelfAlternatives: string[];
}
`;

const entersFile = `/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: compound "enters or <event>" prefix used by leftover detectors
 * Public: ENTERS_OR_OTHER_EVENT_PREFIX
 */

${entersBytes.toString('utf8').replace(/^const /m, 'export const ')}`;

const destructure = `  const {
    triggers,
    oracleText,
    lowerOracle,
    cardName,
    lowerName,
    permanentId,
    counters,
    dieNameVariants,
    dieSelfAlternatives,
  } = state;
`;

function helperFile(name, cluster, extraImports, body) {
  return `/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover detectDeathTriggers ${cluster} pattern run
 * Public: ${name}
 */

${extraImports}import type { DeathDetectionState } from "./death-detection-state.js";

export function ${name}(state: DeathDetectionState): void {
${destructure}
${body.toString('utf8')}}
`;
}

const earlyFile = helperFile(
  'appendDeathDetectionEarly',
  'early',
  `import { timingTriggerEffect } from "./timing-effect-extraction.js";
import { ENTERS_OR_OTHER_EVENT_PREFIX } from "./enters-or-other-event-prefix.js";
`,
  earlyBytes,
);

const midFile = helperFile(
  'appendDeathDetectionMid',
  'mid',
  `import { timingTriggerEffect } from "./timing-effect-extraction.js";
`,
  midBytes,
);

const lateFile = helperFile(
  'appendDeathDetectionLate',
  'late',
  `import { timingTriggerEffect } from "./timing-effect-extraction.js";
import { KNOWN_DEATH_TRIGGERS } from "./card-data-tables.js";
`,
  lateBytes,
);

const collectExported = Buffer.from(
  collectBytes.toString('utf8').replace(/^function /, 'export function '),
  'utf8',
);

const orchestrator = `/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover detectDeathTriggers (merged into triggers/; leftover re-exports)
 * Public: detectDeathTriggers, collectDeathTriggerEffectText
 */

import { timingTriggerEffect } from "./timing-effect-extraction.js";
import { buildCardNameRegexAlternatives } from "./cardNameRegexAlternatives.js";
import type { TriggeredAbility } from "./detectorTriggeredAbility.js";
import type { DeathDetectionState } from "./death-detection-state.js";
import { appendDeathDetectionEarly } from "./death-detection-early.js";
import { appendDeathDetectionMid } from "./death-detection-mid.js";
import { appendDeathDetectionLate } from "./death-detection-late.js";

${collectExported.toString('utf8')}
${jsdocBytes.toString('utf8')}${prologueBytes.toString('utf8')}
  const state: DeathDetectionState = {
    triggers,
    oracleText,
    lowerOracle,
    cardName,
    lowerName,
    permanentId,
    counters,
    dieNameVariants,
    dieSelfAlternatives,
  };
  appendDeathDetectionEarly(state);
  appendDeathDetectionMid(state);
  appendDeathDetectionLate(state);
  return triggers;
}
`;

// leftover splice: 2542-5014 inclusive, keep the blank after closing brace if CLUSTER_END is the `}`.
const clusterStartOff = leftoverStarts[COLLECT_START - 1];
const clusterEndOff = leftoverStarts[CLUSTER_END]; // start of next line after `}`
const leftoverBefore = leftover.subarray(0, clusterStartOff);
const leftoverMoved = leftover.subarray(clusterStartOff, clusterEndOff);
const leftoverAfter = leftover.subarray(clusterEndOff);
if (!Buffer.concat([leftoverBefore, leftoverMoved, leftoverAfter]).equals(leftover)) {
  console.error('leftover identity check failed');
  process.exit(1);
}

const leftoverReplacement = Buffer.from(
  `export { detectDeathTriggers } from "./triggers/zone-changes.js";\n\n`,
  'utf8',
);
const newLeftover = Buffer.concat([leftoverBefore, leftoverReplacement, leftoverAfter]);

// zone-changes: replace JSDoc+detectDeathTriggers with re-export. File is CRLF.
const zone = fs.readFileSync(zonePath);
const zoneText = zone.toString('utf8');
const zoneLines = zoneText.split(/\r?\n/);
const zoneFn = zoneLines.findIndex((l) => l.startsWith('export function detectDeathTriggers'));
if (zoneFn < 0) {
  console.error('zone-changes detectDeathTriggers not found');
  process.exit(1);
}
let zoneJsdoc = zoneFn;
while (zoneJsdoc > 0 && zoneLines[zoneJsdoc - 1].trim() !== '' && !zoneLines[zoneJsdoc - 1].startsWith('// ===')) {
  zoneJsdoc -= 1;
}
// include the section banner above JSDoc if present
if (zoneJsdoc > 0 && zoneLines[zoneJsdoc - 1].includes('Death Trigger Detection')) {
  zoneJsdoc -= 3; // banner block
  while (zoneJsdoc > 0 && zoneLines[zoneJsdoc].trim() === '') zoneJsdoc += 0;
}
let zoneEnd = zoneFn;
let depth = 0;
let started = false;
for (let i = zoneFn; i < zoneLines.length; i += 1) {
  const opens = (zoneLines[i].match(/\{/g) || []).length;
  const closes = (zoneLines[i].match(/\}/g) || []).length;
  depth += opens - closes;
  started = started || opens > 0;
  if (started && depth === 0) {
    zoneEnd = i;
    break;
  }
}

const zoneImportLine = `import { detectDeathTriggers } from "./death-detection.js";`;
if (zoneText.includes('from "./death-detection.js"')) {
  console.error('zone-changes already imports death-detection');
  process.exit(1);
}

const zoneNewLines = [
  ...zoneLines.slice(0, zoneJsdoc),
  'export { detectDeathTriggers } from "./death-detection.js";',
  ...zoneLines.slice(zoneEnd + 1),
];
const typesImportIdx = zoneNewLines.findIndex((l) => l.includes('from "./types.js"'));
if (typesImportIdx < 0) {
  console.error('zone-changes types import not found');
  process.exit(1);
}
const insertAt = typesImportIdx + 1;
zoneNewLines.splice(insertAt, 0, zoneImportLine);

const zoneOut = Buffer.from(toCrlf(zoneNewLines.join('\n')), 'utf8');

const outFiles = {
  'server/src/state/modules/triggers/death-detection-state.ts': Buffer.from(stateFile, 'utf8'),
  'server/src/state/modules/triggers/enters-or-other-event-prefix.ts': Buffer.from(entersFile, 'utf8'),
  'server/src/state/modules/triggers/death-detection-early.ts': Buffer.from(earlyFile, 'utf8'),
  'server/src/state/modules/triggers/death-detection-mid.ts': Buffer.from(midFile, 'utf8'),
  'server/src/state/modules/triggers/death-detection-late.ts': Buffer.from(lateFile, 'utf8'),
  'server/src/state/modules/triggers/death-detection.ts': Buffer.from(orchestrator, 'utf8'),
};

console.log('leftover cluster', COLLECT_START, '-', CLUSTER_END, leftoverMoved.length, 'B');
for (const [p, buf] of Object.entries(outFiles)) {
  console.log(p, buf.length, 'B', (buf.length / 1024).toFixed(1), 'KB');
  if (buf.length > 40960) console.error('  OVER CEILING');
}
console.log('new leftover', newLeftover.length, 'was', leftover.length);
console.log('zone-changes splice lines', zoneJsdoc + 1, '-', zoneEnd + 1, '-> re-export; import at', insertAt + 1);

if (dry) {
  console.log('dry run');
  process.exit(0);
}

for (const p of Object.keys(outFiles)) {
  if (fs.existsSync(p)) {
    console.error('refusing to overwrite', p);
    process.exit(1);
  }
}

for (const [p, buf] of Object.entries(outFiles)) fs.writeFileSync(p, buf);
fs.writeFileSync(leftoverPath, newLeftover);
fs.writeFileSync(zonePath, zoneOut);
console.log('written');
