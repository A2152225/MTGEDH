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
  'Eluge, the Shoreless Sea',
  'Dream Spoilers',
  'Illuna, Apex of Wishes',
  'Mathas, Fiend Seeker',
  'Primal Empathy',
  'Rottenmouth Viper',
  'Purgatory',
  'The Value Knight',
  'Booster Blitz',
  'Bubbling Muck',
  'Hopeless Nightmare',
  'Zoraline, Cosmos Caller',
  'Cosmos Elixir',
  'Magnetic Mountain',
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
  'the first instant or sorcery spell you cast each turn costs {u} less to cast for each land you control',
  'up to one target creature an opponent controls gets -1/-1 until end of turn',
  'a card and gains 2',
  'a card if you control a creature with the greatest power among creatures on the battlefield',
  'you may pay {4} and 2 life',
  'two cards instead',
  'they get to go first in the next game',
  'that player adds an additional {b}',
  'a card and loses 2',
  'you may pay {w}{b} and 2 life',
  'their',
  'a card if your life total is greater than your starting life total',
  'that player may choose any number of tapped blue creatures they control and pay {4} for each creature chosen this way',
];
console.log('\n--- standalone ---');
for (const s of samples) console.log(s.slice(0, 90), '->', gapsForEffect(s));
