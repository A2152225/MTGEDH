import { readFileSync } from 'fs';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { serverDetectsTrigger } from './trigger-coverage-audit.ts';

function getOracle(card: { oracle_text?: string; card_faces?: { oracle_text?: string }[] }) {
  return card.card_faces
    ? card.card_faces.map((f) => f.oracle_text).filter(Boolean).join('\n')
    : String(card.oracle_text || '');
}

function isMinigameOracle(card: { name: string; oracle_text?: string; card_faces?: { oracle_text?: string }[] }) {
  const o = getOracle(card);
  return /\bOBJECTIVE:\b/i.test(o) || /\|\s*\d+\s*pack/i.test(o) || /\(minigame\)/i.test(card.name);
}

const audit = JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8'));
const cards = JSON.parse(readFileSync(audit.meta.oraclePath, 'utf8'));

let total = 0;
let minigame = 0;
const real: string[] = [];

for (const card of cards) {
  const o = getOracle(card);
  if (!o) continue;
  const parsed = parseTriggeredAbilitiesFromText(o, 'SRC', 'P1', card.name);
  for (const t of parsed) {
    if (t.triggerFilter !== 'unknown_trigger_pattern') continue;
    if (serverDetectsTrigger(card, t)) continue;
    total++;
    if (isMinigameOracle(card)) minigame++;
    else if (real.length < 30) real.push(card.name);
  }
}
console.log({ total, minigame, realRemaining: total - minigame });
for (const n of real) console.log(' ', n);
