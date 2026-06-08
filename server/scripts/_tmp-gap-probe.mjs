import fs from 'fs';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import {
  detectETBTriggers, detectDeathTriggers, detectAttackTriggers, detectBlockTriggers,
  detectCombatDamageTriggers, detectTapTriggers, detectLTBTriggers, detectSpellCastTriggers,
  detectAbilityActivatedTriggers, detectDiscardTriggers, detectTargetedTriggers,
} from '../src/state/modules/triggered-abilities.js';
import { detectCounterPlacedTriggers } from '../src/state/modules/triggers/counters.js';
import { detectLeftGraveyardTriggers, detectPutIntoGraveyardTriggers } from '../src/state/modules/triggers/zone-change.js';
import { detectUpkeepTriggers } from '../src/state/modules/upkeep-triggers.js';
import { detectSacrificeTriggers } from '../src/state/modules/triggers/sacrifice.js';
import { detectOpponentSpellCastTriggers } from '../src/state/modules/triggers/spell-cast.js';

const detectors = [
  detectETBTriggers, detectDeathTriggers, detectAttackTriggers, detectBlockTriggers,
  detectCombatDamageTriggers, detectTapTriggers, detectLTBTriggers, detectSpellCastTriggers,
  detectAbilityActivatedTriggers, detectDiscardTriggers, detectTargetedTriggers,
  detectCounterPlacedTriggers, detectLeftGraveyardTriggers, detectPutIntoGraveyardTriggers,
  detectUpkeepTriggers, detectSacrificeTriggers, detectOpponentSpellCastTriggers,
];

function anyDetect(cardObj, permanent) {
  return detectors.some((fn) => fn(cardObj, permanent).length > 0);
}

function collectUnknown(value, gaps = []) {
  if (!value || typeof value !== 'object') return gaps;
  if (!Array.isArray(value) && value.kind === 'unknown') gaps.push(String(value.raw || '').slice(0, 100));
  for (const x of Array.isArray(value) ? value : Object.values(value)) collectUnknown(x, gaps);
  return gaps;
}

const audit = JSON.parse(fs.readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8'));
const samples = new Set();
for (const p of audit.topPatterns || []) for (const s of p.effectGapSamples || []) samples.add(s);

const still = [];
for (const s of samples) {
  const ir = parseOracleTextToIR(s, 'Probe');
  const gaps = [];
  for (const a of ir.abilities || []) for (const step of a.steps || []) collectUnknown(step, gaps);
  if (gaps.length) still.push(s);
}
console.log('IR gaps from audit samples:', still.length, '/', samples.size);
for (const s of still.slice(0, 25)) console.log(' -', s.slice(0, 95));

const cards = JSON.parse(fs.readFileSync('../oracle-cards.json', 'utf8'));
const permanent = { id: 'P1', controller: 'P1' };
const unknownCounts = new Map();
let shown = 0;
for (const card of cards) {
  const text = [card.oracle_text, ...(card.card_faces || []).map((f) => f.oracle_text)].filter(Boolean).join('\n');
  if (!text) continue;
  for (const t of parseTriggeredAbilitiesFromText(text, 'S', 'P1', card.name)) {
    if (t.triggerFilter !== 'unknown_trigger_pattern') continue;
    const cardObj = { name: card.name, oracle_text: text, type_line: card.type_line };
    if (anyDetect(cardObj, permanent)) continue;
    const clause = String(t.condition || t.triggerFilter || '').slice(0, 70);
    unknownCounts.set(clause, (unknownCounts.get(clause) || 0) + 1);
    if (shown < 15) {
      console.log('\nUNK', card.name, '|', clause);
      console.log(' eff:', String(t.effect || '').slice(0, 85));
      shown++;
    }
  }
}
console.log('\nTop unknown clauses still not detected:');
[...unknownCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, n]) => console.log(n, k));
