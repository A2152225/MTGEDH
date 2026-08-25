// Chat C: merge leftover detectETBTriggers into triggers/, split under 40KB.
import fs from 'node:fs';

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

function toCrlf(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
}

const leftover = fs.readFileSync(leftoverPath);
const leftoverStarts = lineStartsOf(leftover);
const leftoverLines = leftover.toString('utf8').split('\n');

const HELPERS_START = 6475;
const HELPERS_END = 6539;
const FN_START = 6541;
const FN_SIG = 6544;
const PROLOGUE_START = 6545;
const PROLOGUE_END = 6615;
const EARLY_START = 6616;
const EARLY_END = 7394;
const MID_START = 7396;
const MID_END = 8084;
const LATE_START = 8086;
const LATE_END = 8228;
const CLUSTER_END = 8238; // through getETBTriggersForPermanent

function expectLine(n, re, label) {
  const line = leftoverLines[n - 1] ?? '';
  if (!re.test(line)) {
    console.error(`boundary fail ${label}: line ${n} = ${JSON.stringify(line)}`);
    process.exit(1);
  }
}

expectLine(HELPERS_START, /^function isHideawayLookEffectText/, 'helpers');
expectLine(HELPERS_END, /^\];$/, 'ltb alts end');
expectLine(FN_SIG, /^export function detectETBTriggers/, 'detectETB');
expectLine(PROLOGUE_END, /etbAlternatives = \[\.\.\.ETB_STATIC_ALTERNATIVES/, 'prologue end');
expectLine(EARLY_START, /const putOntoBattlefieldThisWayMatch/, 'early start');
expectLine(EARLY_END, /^\s+\}$/, 'early end');
expectLine(MID_START, /const etbPattern = new RegExp/, 'mid start');
expectLine(MID_END, /^\s+\}$/, 'mid end');
expectLine(LATE_START, /const flyingControlledETBMatch/, 'late start');
expectLine(LATE_END, /^\s+\}$/, 'late end');
expectLine(CLUSTER_END, /^\}$/, 'getETB end');

const helpersBytes = sliceLines(leftover, leftoverStarts, HELPERS_START, HELPERS_END);
const jsdocBytes = sliceLines(leftover, leftoverStarts, FN_START, FN_SIG);
const prologueBytes = sliceLines(leftover, leftoverStarts, PROLOGUE_START, PROLOGUE_END);
const earlyBytes = sliceLines(leftover, leftoverStarts, EARLY_START, EARLY_END);
const midBytes = sliceLines(leftover, leftoverStarts, MID_START, MID_END);
const lateBytes = sliceLines(leftover, leftoverStarts, LATE_START, LATE_END);

const helpersText = helpersBytes.toString('utf8')
  .replace(/^function /gm, 'export function ')
  .replace(/^const /gm, 'export const ');

const stateFile = `/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: shared locals for leftover detectETBTriggers split
 * Public: EtbDetectionState
 */

import type { TriggeredAbility } from "./detectorTriggeredAbility.js";

export interface EtbDetectionState {
  triggers: TriggeredAbility[];
  oracleText: string;
  lowerOracle: string;
  cardName: string;
  lowerName: string;
  permanentId: string;
  etbNameVariants: string[];
  etbAlternatives: string[];
  card: any;
  permanent: any;
}
`;

const destructure = `  const {
    triggers,
    oracleText,
    lowerOracle,
    cardName,
    lowerName,
    permanentId,
    etbNameVariants,
    etbAlternatives,
    card,
    permanent,
  } = state;
`;

function helperFile(name, cluster, extraImports, body) {
  return `/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover detectETBTriggers ${cluster} pattern run
 * Public: ${name}
 */

${extraImports}import type { EtbDetectionState } from "./etb-detection-state.js";

export function ${name}(state: EtbDetectionState): void {
${destructure}
${body.toString('utf8')}}
`;
}

const earlyFile = helperFile(
  'appendEtbDetectionEarly',
  'early',
  `import { timingTriggerEffect } from "./timing-effect-extraction.js";
import { isSwallowedCompoundEnterEffect } from "./etb-detection-helpers.js";
`,
  earlyBytes,
);

const midFile = helperFile(
  'appendEtbDetectionMid',
  'mid',
  `import { timingTriggerEffect } from "./timing-effect-extraction.js";
import { oracleTextHasDoThisOnlyOnceEachTurn, oracleTextHasTriggersOnlyOnceEachTurn } from "../triggerDoThisOnlyOnceEachTurn.js";
import { isEtbCreatureTypeChoiceOracle, parseChosenTypeCreatureEtbTrigger } from "../chosen-creature-type.js";
import { parseMillFromOracleText } from "../../../../../rules-engine/src/keywordActions/mill.js";
import { isModalChooseModesEffectText } from "../inferTriggeredAbilityTargetMetadata.js";
import { isLandfallEtbSubjectPhrase } from "./landfall.js";
import { detectHideawayAbility } from "./hideaway-ability.js";
import { detectTargetType } from "./detect-target-type.js";
import {
  ENTERS_OR_EVENT_SUFFIX,
  isHideawayLookEffectText,
  isOracleIndexInsideParenthetical,
  isSwallowedCompoundEnterEffect,
} from "./etb-detection-helpers.js";
`,
  midBytes,
);

const lateFile = helperFile(
  'appendEtbDetectionLate',
  'late',
  `import { timingTriggerEffect } from "./timing-effect-extraction.js";
import { detectHideawayAbility } from "./hideaway-ability.js";
import { isHideawayLookEffectText } from "./etb-detection-helpers.js";
`,
  lateBytes,
);

const helpersFile = `/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover ETB detector helpers and static alternatives
 * Public: isHideawayLookEffectText, isOracleIndexInsideParenthetical, ETB_STATIC_ALTERNATIVES,
 *   ENTERS_OR_EVENT_SUFFIX, isSwallowedCompoundEnterEffect, LTB_STATIC_ALTERNATIVES
 */

${helpersText}`;

const orchestrator = `/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover detectETBTriggers (merged into triggers/; leftover re-exports)
 * Public: detectETBTriggers
 */

import { timingTriggerEffect } from "./timing-effect-extraction.js";
import { buildCardNameRegexAlternatives } from "./cardNameRegexAlternatives.js";
import { KNOWN_ETB_TRIGGERS } from "./card-data-tables.js";
import { stripReminderParentheticals } from "../../../../../rules-engine/src/oracleReminderText.js";
import type { TriggeredAbility } from "./detectorTriggeredAbility.js";
import type { EtbDetectionState } from "./etb-detection-state.js";
import { ETB_STATIC_ALTERNATIVES } from "./etb-detection-helpers.js";
import { appendEtbDetectionEarly } from "./etb-detection-early.js";
import { appendEtbDetectionMid } from "./etb-detection-mid.js";
import { appendEtbDetectionLate } from "./etb-detection-late.js";

${jsdocBytes.toString('utf8')}${prologueBytes.toString('utf8')}
  const state: EtbDetectionState = {
    triggers,
    oracleText,
    lowerOracle,
    cardName,
    lowerName,
    permanentId,
    etbNameVariants,
    etbAlternatives,
    card,
    permanent,
  };
  appendEtbDetectionEarly(state);
  appendEtbDetectionMid(state);
  appendEtbDetectionLate(state);
  return triggers;
}
`;

const clusterStartOff = leftoverStarts[HELPERS_START - 1];
const clusterEndOff = leftoverStarts[CLUSTER_END];
const leftoverBefore = leftover.subarray(0, clusterStartOff);
const leftoverMoved = leftover.subarray(clusterStartOff, clusterEndOff);
const leftoverAfter = leftover.subarray(clusterEndOff);
if (!Buffer.concat([leftoverBefore, leftoverMoved, leftoverAfter]).equals(leftover)) {
  console.error('leftover identity check failed');
  process.exit(1);
}

const leftoverReplacement = Buffer.from(
  `export { detectETBTriggers, getETBTriggersForPermanent } from "./triggers/zone-changes.js";\n\n`,
  'utf8',
);
const newLeftover = Buffer.concat([leftoverBefore, leftoverReplacement, leftoverAfter]);

const zone = fs.readFileSync(zonePath);
const zoneText = zone.toString('utf8');
const zoneLines = zoneText.split(/\r?\n/);
const zoneFn = zoneLines.findIndex((l) => l.startsWith('export function detectETBTriggers'));
if (zoneFn < 0) {
  console.error('zone-changes detectETBTriggers not found');
  process.exit(1);
}
let zoneJsdoc = zoneFn;
while (zoneJsdoc > 0 && !zoneLines[zoneJsdoc - 1].includes('ETB Trigger Detection')) {
  zoneJsdoc -= 1;
}
if (zoneJsdoc > 0 && zoneLines[zoneJsdoc - 1].includes('ETB Trigger Detection')) {
  zoneJsdoc -= 2; // banner // === above the title
}
const nextExport = zoneLines.findIndex((l, i) => i > zoneFn && /^export function /.test(l));
if (nextExport < 0) {
  console.error('next export after detectETBTriggers not found');
  process.exit(1);
}
let zoneEnd = nextExport - 1;
while (zoneEnd > zoneFn && zoneLines[zoneEnd].trim() !== '}') zoneEnd -= 1;

const zoneImportLine = `import { detectETBTriggers } from "./etb-detection.js";`;
if (zoneText.includes('from "./etb-detection.js"')) {
  console.error('zone-changes already imports etb-detection');
  process.exit(1);
}

const zoneNewLines = [
  ...zoneLines.slice(0, zoneJsdoc),
  'export { detectETBTriggers } from "./etb-detection.js";',
  ...zoneLines.slice(zoneEnd + 1),
];
const typesImportIdx = zoneNewLines.findIndex((l) => l.includes('from "./death-detection.js"') || l.includes('from "./types.js"'));
const deathImportIdx = zoneNewLines.findIndex((l) => l.includes('from "./death-detection.js"'));
const insertAt = (deathImportIdx >= 0 ? deathImportIdx : typesImportIdx) + 1;
zoneNewLines.splice(insertAt, 0, zoneImportLine);

const zoneOut = Buffer.from(toCrlf(zoneNewLines.join('\n')), 'utf8');

const outFiles = {
  'server/src/state/modules/triggers/etb-detection-state.ts': Buffer.from(stateFile, 'utf8'),
  'server/src/state/modules/triggers/etb-detection-helpers.ts': Buffer.from(helpersFile, 'utf8'),
  'server/src/state/modules/triggers/etb-detection-early.ts': Buffer.from(earlyFile, 'utf8'),
  'server/src/state/modules/triggers/etb-detection-mid.ts': Buffer.from(midFile, 'utf8'),
  'server/src/state/modules/triggers/etb-detection-late.ts': Buffer.from(lateFile, 'utf8'),
  'server/src/state/modules/triggers/etb-detection.ts': Buffer.from(orchestrator, 'utf8'),
};

console.log('leftover cluster', HELPERS_START, '-', CLUSTER_END, leftoverMoved.length, 'B');
for (const [p, buf] of Object.entries(outFiles)) {
  const over = buf.length > 40960 ? ' OVER' : '';
  console.log(p, buf.length, 'B', (buf.length / 1024).toFixed(1), 'KB' + over);
}
console.log('new leftover', newLeftover.length, 'was', leftover.length);
console.log('zone-changes splice lines', zoneJsdoc + 1, '-', zoneEnd + 1, 'import at', insertAt + 1);

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
