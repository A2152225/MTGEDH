import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';

function gaps(text: string): string[] {
  const ir = parseOracleTextToIR(text, 'T');
  const g: string[] = [];
  const walk = (v: unknown): void => {
    if (!v || typeof v !== 'object') return;
    if ((v as { kind?: string }).kind === 'unknown') {
      g.push(String((v as { raw?: string }).raw || ''));
      return;
    }
    if (Array.isArray(v)) return v.forEach(walk);
    for (const [k, c] of Object.entries(v)) {
      if (!['raw', 'text', 'effectText'].includes(k)) walk(c);
    }
  };
  for (const a of ir.abilities || []) for (const s of a.steps || []) walk(s);
  return g;
}

const samples = [
  'target player draws two cards and loses 2 life',
  'target player draws a card and loses 1 life',
  'Until end of turn, if you would draw a card, draw two cards instead."',
  'you investigate x times, where x is one plus the number of opponents who investigated this way',
];
for (const s of samples) {
  console.log('\n===', s.slice(0, 90), '===');
  console.log('gaps:', gaps(s).length ? gaps(s) : 'OK');
  console.log('steps:', JSON.stringify(parseOracleTextToIR(s, 'T').abilities?.[0]?.steps, null, 2));
}
