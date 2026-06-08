import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';

function findUnknown(v: unknown, gaps: string[] = []): string[] {
  if (!v || typeof v !== 'object') return gaps;
  if (Array.isArray(v)) {
    for (const x of v) findUnknown(x, gaps);
    return gaps;
  }
  const r = v as Record<string, unknown>;
  if (r.kind === 'unknown') gaps.push(String(r.raw || ''));
  for (const [k, c] of Object.entries(r)) {
    if (!['raw', 'text', 'effectText'].includes(k)) findUnknown(c, gaps);
  }
  return gaps;
}

const samples = [
  'that player draws an additional card',
  'draw two additional cards',
  "draw a card at the beginning of the next turn's upkeep",
  "a card at the beginning of the next turn's upkeep",
  'station 10+ | flying',
  'augment {3}{w}',
  'that player loses the game',
  'seek a nonland card',
  'dredge 2',
  'two additional cards',
  'x life and draw x cards',
  'you control enchanted creature',
  'up to two cards',
  'another',
  'cards you own named this permanent intensify by 1',
  'At the beginning of your draw step, draw two additional cards.',
  'Whenever this creature attacks, augment {3}{w}',
];

for (const s of samples) {
  const ir = parseOracleTextToIR(s, 'Test');
  const gaps: string[] = [];
  for (const a of ir.abilities || []) {
    for (const st of a.steps || []) findUnknown(st, gaps);
  }
  console.log(s, '->', gaps.length ? gaps : 'OK');
}
