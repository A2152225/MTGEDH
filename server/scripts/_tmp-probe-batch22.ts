import { readFileSync } from 'fs';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { serverDetectsTrigger } from './trigger-coverage-audit.ts';
import {
  detectBlockTriggers,
  detectDeathTriggers,
  detectAttackTriggers,
  detectETBTriggers,
} from '../src/state/modules/triggered-abilities.ts';

const audit = JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8'));
const cards = JSON.parse(readFileSync(audit.meta.oraclePath, 'utf8'));
const FAKE = { id: 'P1', cardName: 'x', controllerId: 'C1' };

const wants = ['Cunning', 'Earth Rumble', 'Foraging Squirrels', "Demon's Due"];

for (const want of wants) {
  const matches = cards.filter((x: { name: string }) => x.name === want || x.name.startsWith(want));
  console.log(`\n=== ${want} (${matches.length} matches) ===`);
  for (const c of matches.slice(0, 3)) {
    const o = c.card_faces
      ? c.card_faces.map((f: { oracle_text?: string }) => f.oracle_text).filter(Boolean).join('\n')
      : c.oracle_text;
    console.log('name:', c.name, 'id:', c.oracle_id || c.id);
    console.log('oracle:', String(o || '').slice(0, 200));
    const parsed = parseTriggeredAbilitiesFromText(o, 'SRC', 'P1', c.name);
    const misses = parsed.filter((t) => !serverDetectsTrigger(c, t));
    console.log('parsed:', parsed.length, 'misses:', misses.length);
    for (const t of parsed) {
      const ok = serverDetectsTrigger(c, t);
      console.log(' ', ok ? 'OK' : 'MISS', t.event, '|', (t.condition || t.triggerFilter || '').slice(0, 80));
    }
    const cardObj = { name: c.name, oracle_text: o, type_line: c.type_line };
    console.log('detectors:', {
      block: detectBlockTriggers(cardObj, FAKE).length,
      attack: detectAttackTriggers(cardObj, FAKE).length,
      death: detectDeathTriggers(cardObj, FAKE).length,
      etb: detectETBTriggers(cardObj, FAKE).length,
    });
  }
}

// Sample unknown_trigger_pattern misses
let unknownCount = 0;
const unknownSamples: string[] = [];
for (const card of cards) {
  const o = card.card_faces
    ? card.card_faces.map((f: { oracle_text?: string }) => f.oracle_text).filter(Boolean).join('\n')
    : card.oracle_text;
  if (!o) continue;
  const parsed = parseTriggeredAbilitiesFromText(o, 'SRC', 'P1', card.name);
  for (const t of parsed) {
    if (t.triggerFilter !== 'unknown_trigger_pattern') continue;
    if (serverDetectsTrigger(card, t)) continue;
    unknownCount++;
    if (unknownSamples.length < 8) unknownSamples.push(`${card.name}: ${String(o).slice(0, 120)}`);
  }
}
console.log(`\nunknown_trigger_pattern not_detected: ${unknownCount}`);
for (const s of unknownSamples) console.log(' ', s);
