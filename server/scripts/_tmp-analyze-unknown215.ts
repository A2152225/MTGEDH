import { readFileSync } from 'fs';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { serverDetectsTrigger } from './trigger-coverage-audit.ts';

const audit = JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8'));
const cards = JSON.parse(readFileSync(audit.meta.oraclePath, 'utf8'));

const buckets = new Map<string, string[]>();

for (const card of cards) {
  const o = card.card_faces
    ? card.card_faces.map((f: { oracle_text?: string }) => f.oracle_text).filter(Boolean).join('\n')
    : card.oracle_text;
  if (!o) continue;
  const parsed = parseTriggeredAbilitiesFromText(o, 'SRC', 'P1', card.name);
  for (const t of parsed) {
    if (t.triggerFilter !== 'unknown_trigger_pattern') continue;
    if (serverDetectsTrigger(card, t)) continue;
    let bucket = 'other';
    if (/\bOBJECTIVE:\b/i.test(o) || /\|\s*\d+\s*pack/i.test(o)) bucket = 'minigame';
    else if (/\bwhenever\b/i.test(o) || /\bwhen\b/i.test(o)) bucket = 'has_when_clause';
    const arr = buckets.get(bucket) || [];
    if (arr.length < 5) arr.push(`${card.name} | ${String(o).slice(0, 100)}`);
    buckets.set(bucket, arr);
  }
}

let total = 0;
for (const card of cards) {
  const o = card.card_faces
    ? card.card_faces.map((f: { oracle_text?: string }) => f.oracle_text).filter(Boolean).join('\n')
    : card.oracle_text;
  if (!o) continue;
  const parsed = parseTriggeredAbilitiesFromText(o, 'SRC', 'P1', card.name);
  for (const t of parsed) {
    if (t.triggerFilter !== 'unknown_trigger_pattern') continue;
    if (serverDetectsTrigger(card, t)) continue;
    total++;
  }
}
console.log('total unknown not_detected:', total);
for (const [k, v] of buckets) {
  console.log(`\n${k}:`);
  for (const s of v) console.log(' ', s);
}

// Find Cunning aura
const cunning = cards.find((c: { oracle_id?: string }) => c.oracle_id === 'd5e48041-5f21-48e6-bd0c-000f02dfbe8a');
if (cunning) {
  const o = cunning.oracle_text;
  console.log('\nCunning aura:', cunning.name, o);
  const parsed = parseTriggeredAbilitiesFromText(o, 'SRC', 'P1', cunning.name);
  for (const t of parsed) {
    console.log(' ', serverDetectsTrigger(cunning, t), t.event, t.condition || t.triggerFilter);
  }
}
