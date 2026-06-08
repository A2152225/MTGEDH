import { readFileSync } from 'fs';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { serverDetectsTrigger } from './trigger-coverage-audit.ts';

function collectGaps(value: unknown): string[] {
  const gaps: string[] = [];
  const walk = (v: unknown): void => {
    if (!v || typeof v !== 'object') return;
    if ((v as { kind?: string }).kind === 'unknown') {
      gaps.push(String((v as { raw?: string }).raw || ''));
      return;
    }
    if (Array.isArray(v)) return v.forEach(walk);
    for (const [k, c] of Object.entries(v)) {
      if (!['raw', 'text', 'effectText'].includes(k)) walk(c);
    }
  };
  walk(value);
  return gaps;
}

const cards = JSON.parse(readFileSync('D:/Git/MTGEDH/oracle-cards.json', 'utf8'));
const names = [
  'Pest Rescuer',
  'Goblin Goliath',
  'Curse of Hospitality',
  'Shadow, Mysterious Assassin',
  'Key to the Archive',
  'Cackling Observer',
  'Baldin, Century Herdmaster',
  'Only Blood Ends Your Nightmares',
  'Prize Pig',
  'A Display of My Dark Power',
];

for (const name of names) {
  const card = cards.find((c: { name: string }) => c.name.startsWith(name));
  if (!card) {
    console.log('MISSING', name);
    continue;
  }
  const o = card.card_faces
    ? card.card_faces.map((f: { oracle_text?: string }) => f.oracle_text).filter(Boolean).join('\n')
    : String(card.oracle_text || '');
  const parsed = parseTriggeredAbilitiesFromText(o, 'SRC', 'P1', card.name);
  for (const t of parsed) {
    if (!serverDetectsTrigger(card, t)) continue;
    const ir = parseOracleTextToIR(t.effect, card.name);
    const gaps: string[] = [];
    for (const a of ir.abilities || []) {
      for (const s of a.steps || []) collectGaps(s).forEach((g) => gaps.push(g));
    }
    if (!gaps.length) continue;
    console.log(`\n=== ${card.name} [${t.event}] ===`);
    console.log('effect:', t.effect.slice(0, 220));
    console.log('gaps:', gaps.slice(0, 4));
  }
}

const standalone = [
  'that much life plus 1 instead',
  'damage to an opponent this turn, it deals double that',
  'the mana value of the sacrificed permanent',
  'draft a card from this artifact\'s spellbook',
  'until end of turn, that creature\'s controller may play that card and they may spend mana as though it were mana of any color to cast spells this way',
  'transform this equipment',
  'you can\'t lose the game',
  'the exiled card\'s owner seeks a nonland card with lesser mana value than the exiled card',
];
console.log('\n--- standalone ---');
for (const t of standalone) {
  const ir = parseOracleTextToIR(t, 'Test');
  const gaps: string[] = [];
  for (const a of ir.abilities || []) {
    for (const s of a.steps || []) collectGaps(s).forEach((g) => gaps.push(g));
  }
  console.log(gaps.length ? `FAIL [${gaps[0].slice(0, 80)}]` : 'OK', t.slice(0, 70));
}
