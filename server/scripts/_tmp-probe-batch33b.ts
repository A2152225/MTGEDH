import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';

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

const samples = [
  'you may cast the artifact later from exile.)',
  'to win:',
  '(put it onto the battlefield face down as a 2/2 creature',
  '(they\'re enchantments with "{2}, sacrifice this token: scry 1',
  'this',
  'that many',
  'the exiled card\'s owner',
  'you may cast a spell with mana value x or less from among cards revealed this way without paying its mana cost. put the rest on the bottom of your library in a random order',
];

for (const t of samples) {
  const ir = parseOracleTextToIR(t, 'Test');
  const gaps: string[] = [];
  for (const a of ir.abilities || []) {
    for (const s of a.steps || []) collectGaps(s).forEach((g) => gaps.push(g));
  }
  console.log(gaps.length ? `FAIL [${gaps.join(' | ')}]` : 'OK', t.slice(0, 85));
}
