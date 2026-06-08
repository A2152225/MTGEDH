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

function gapsFor(text: string, card = 'Test'): string[] {
  const ir = parseOracleTextToIR(text, card);
  const gaps: string[] = [];
  for (const a of ir.abilities || []) {
    for (const s of a.steps || []) collectGaps(s).forEach((g) => gaps.push(g));
  }
  return gaps;
}

const standalone = [
  'draw two cards unless you discard an instant or sorcery card or a creature card with flying',
  'damage to an opponent this turn, it deals double that damage to you',
  'then you may pay {x}, where x is the number of +1/+1 counters on it',
  'the greatest mana value among equipment attached to it',
  'a card unless there are three or more lesson cards in your graveyard',
  'this permanent gets +1/+1 for each lesson card in your graveyard',
  'it perpetually gains double team',
  'you may choose a creature card from among them',
  'until end of turn, this creature has base power and toughness 5/3, gains trample, and is not a human',
  'you have no maximum hand size and do not lose the game for having 0 or less life',
  'then they each put the card they revealed into their hand',
  'horror of zhava is untapped, any opponent may sacrifice a nontoken creature',
  'that player puts a flood counter on target non-island land they control of their choice',
  'two cards unless you discard an instant or sorcery card or a creature card with flying',
  'the exiled card\'s owner',
];

console.log('--- standalone ---');
for (const t of standalone) {
  const gaps = gapsFor(t);
  console.log(gaps.length ? `FAIL [${gaps.join(' | ')}] ${t.slice(0, 80)}` : `OK   ${t.slice(0, 80)}`);
}

const cards = JSON.parse(readFileSync('D:/Git/MTGEDH/oracle-cards.json', 'utf8'));
const names = [
  'Steamcore Scholar',
  'Werewolf Pack Leader',
  'Marina Vendrell\'s Grimoire',
  'Parker Luck',
  'Gitrog, Horror of Zhava',
  'Quicksilver Fountain',
  'Kaya, Spirits\' Justice',
  'Tetsuo, Imperial Champion',
  'Sunbird\'s Invocation',
  'Primal Adversary',
  'Najeela, the Blade-Blossom',
  'Selesnya Loft Gardens',
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
    const gaps = gapsFor(t.effect, card.name);
    if (!gaps.length) continue;
    console.log(`\n=== ${card.name} [${t.event}] ===`);
    console.log('effect:', t.effect.slice(0, 200));
    console.log('gaps:', gaps.slice(0, 5));
  }
}
