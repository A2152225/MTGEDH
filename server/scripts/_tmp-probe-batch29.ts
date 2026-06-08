import { readFileSync } from 'fs';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { serverDetectsTrigger } from './trigger-coverage-audit.ts';

function effectTextForIrAudit(effectText: string): string {
  const raw = String(effectText || '').trim();
  const stripped = raw
    .replace(/\([^()]*\)/g, ' ')
    .replace(/\s+\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length >= 4 ? stripped : raw;
}

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

function gapsForEffect(effect: string, card = 'Test'): string[] {
  const ir = parseOracleTextToIR(effectTextForIrAudit(effect), card);
  const gaps: string[] = [];
  for (const a of ir.abilities || []) {
    for (const s of a.steps || []) collectGaps(s).forEach((g) => gaps.push(g));
  }
  return gaps;
}

const audit = JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8'));
const cards = JSON.parse(readFileSync(audit.meta.oraclePath, 'utf8'));

const names = [
  'Sygg, Wanderwine Wisdom',
  'The River Warlock',
  'Prowl, Stoic Strategist',
  'Blitzwing, Cruel Tormentor',
  'Arms Scavenger',
  'Necrodominance',
  'Druid Class',
  'Aetherwind Basker',
  'Tetzin, Gnome Champion',
  'Truss, Chief Engineer',
  'Blight Titan',
  'The Keeper of Favorite Cards',
  'Archfiend of Despair',
  'Pact Weapon',
];

for (const name of names) {
  const card = cards.find((c: { name: string }) => c.name === name || c.name.startsWith(name));
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
    const gaps = gapsForEffect(t.effect, card.name);
    if (gaps.length === 0) continue;
    console.log(`\n=== ${card.name} [${t.event}] ===`);
    console.log('effect:', t.effect.slice(0, 220));
    console.log('gaps:', gaps.slice(0, 6));
  }
}

const samples = [
  'a card" until end of turn',
  'their',
  'a card and convert this permanent',
  'the life that player lost this turn',
  "draft a card from this creature's spellbook",
  'you may pay any amount of life',
  'level 2 you may play an additional land on each of your turns',
  'a card and reveal it',
  'you have no maximum hand size until your next turn',
  'you get {e} for each creature you control',
  'transform up to one other target double-faced artifact you control',
  "this effect can't reduce a number below 1 or a number word below one",
  'then incubate x, where x is the number of creature cards in your graveyard',
  'your favorite creatures get +1/+0',
];
console.log('\n--- standalone ---');
for (const s of samples) console.log(s.slice(0, 85), '->', gapsForEffect(s));
