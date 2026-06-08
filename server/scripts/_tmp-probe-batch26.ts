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
  'Steady Tortoise',
  'Geier Reach Bandit',
  'Thieving Aven',
  'Sygg, Wanderwine Wisdom',
  'Balor',
  'Cloistered Youth',
  'Longtusk Stalker',
  'Acornelia, Fashionable Filcher',
  'Valiant Emberkin',
  'Chaos Balor',
  'Stolen Uniform',
  'Oteclán',
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
    console.log('effect:', t.effect.slice(0, 200));
    console.log('gaps:', gaps.slice(0, 5));
  }
}

const samples = [
  'this ability also triggers if this permanent is in exile',
  'you may transform it',
  'you may transform this creature',
  'heist target opponent\'s library',
  'then heist target opponent\'s library',
  'three cards at random',
  'this creature perpetually gets +1/+0',
  'you get {a}',
  'target creature you control perpetually gets +1/+0',
  'unattach it',
  'chaos ensues',
  'until the end of your next turn, you may play that card',
  'two cards instead',
  'you may convert this permanent',
  'then seeks that many nonland cards',
  'a card and loses 2',
];
console.log('\n--- standalone ---');
for (const s of samples) console.log(s, '->', gapsForEffect(s));
