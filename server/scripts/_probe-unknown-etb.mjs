import fs from 'node:fs';
import { parseTriggeredAbility } from '../../rules-engine/src/oracleTextParser.js';
import { detectTriggeredAbilityEvent } from '../../rules-engine/src/triggeredAbilitiesEventDetection.js';
import { TriggerEvent } from '../../rules-engine/src/triggeredAbilitiesTypes.js';
import { detectSpellCastTriggers } from '../src/state/modules/triggered-abilities.js';

function maskParentheticalRegions(text) {
  let out = '';
  let depth = 0;
  for (const char of text) {
    if (char === '(') { depth += 1; out += char; continue; }
    if (char === ')') { depth = Math.max(0, depth - 1); out += char; continue; }
    out += depth > 0 ? (char === '\n' ? '\n' : ' ') : char;
  }
  return out;
}

const cards = JSON.parse(fs.readFileSync(new URL('../../oracle-cards.json', import.meta.url), 'utf8'));
const counts = new Map();
const permanent = { id: 'P1', controller: 'P1' };

for (const card of cards) {
  const oracle = card.card_faces?.map((f) => f.oracle_text).filter(Boolean).join('\n') || card.oracle_text || '';
  if (!oracle) continue;
  const searchable = maskParentheticalRegions(oracle);
  const triggerPattern =
    /\b(?:when(?:ever)?|at\s+the\s+beginning\s+of)\b[\s\S]*?(?=(?:[.?!]\s+|\n+\s*)(?:when(?:ever)?|at\s+the\s+beginning\s+of)\b|$)/gi;
  let m;
  while ((m = triggerPattern.exec(searchable)) !== null) {
    const chunk = oracle.slice(m.index, m.index + m[0].length).trim();
    const parsed = parseTriggeredAbility(chunk);
    if (!parsed?.triggerCondition) continue;
    const eventInfo = detectTriggeredAbilityEvent(parsed.triggerCondition, TriggerEvent);
    if (eventInfo.filter !== 'unknown_trigger_pattern') continue;
    const key = String(parsed.triggerCondition).toLowerCase().trim();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
}

console.log('Top unknown trigger conditions:');
[...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).forEach(([k, n]) => console.log(n, k));

for (const name of ['Hardbristle Bandit', 'Savai Thundermane', 'Overzealous Muscle']) {
  const card = cards.find((c) => c.name === name);
  const oracle = card?.oracle_text || '';
  console.log('\n===', name, '===\n', oracle);
  console.log('detect', detectSpellCastTriggers(card, permanent).length);
}
